var fs = require('fs');
var XPI = require('xpi');
var sm = require('spidermonkey');
var nkima = require('nkima');

function findE4X(node) {
    var found = [];
    var workList = [node];
    do {
        node = workList.pop();
        if (!node || typeof node !== "object")
            continue;
        if (/^XML/.test(node.type)) {
            // Ewwww, an E4X node!
            found.push(node);
            // Don't look inside the node. One ancestor is enough.
            continue;
        }
        var kids = nkima.children(node);
        for (var i = 0, n = kids.length; i < n; i++)
            workList.push(kids[i]);
    } while (workList.length > 0);
    return found.sort(compareNodes);
}

function compareNodes(a, b) {
    return compareLocs(a.loc, b.loc);
}

function compareLocs(a, b) {
    // If a starts *before* b, a < b.
    var aStart = a.start, bStart = b.start;
    if (aStart.line < bStart.line)
        return -1;
    if (aStart.line > bStart.line)
        return 1;
    if (aStart.column < bStart.column)
        return -1;
    if (aStart.column > bStart.column)
        return 1;

    // If a ends *after* b, a < b.
    var aEnd = a.end, bEnd = b.end;
    if (aEnd.line > bEnd.line)
        return -1;
    if (aEnd.line < bEnd.line)
        return 1;
    if (aEnd.column > bEnd.column)
        return -1;
    if (aEnd.column < bEnd.column)
        return 1;
    return 0;
}

function reportScripts(shell, scripts) {
    var parsedCount = 0;
    scripts.forEach(function(script, i) {
        // Some XPI's seem to have function bodies at top level in script fragments.
        var proc = sm.parse("(function(){ " + script.contents + "\n})();", shell);
        proc.on("return", function(ast) {
            script.ast = ast;
            parsedCount++;
            if (parsedCount === scripts.length)
                process.nextTick(findAllE4X);
        });
        proc.on("throw", function(err) {
            script.error = err;
            parsedCount++;
            if (parsedCount === scripts.length)
                process.nextTick(findAllE4X);
        });
    });

    function findAllE4X() {
        var report = scripts.map(function(script) {
            var e4xNodes = findE4X(script.ast);
            return {
                path: script.path,
                nodes: e4xNodes.map(function(e4xNode) {
                    return {
                        line: ((script.line || 1) + e4xNode.loc.start.line - 1),
                        type: e4xNode.type
                    }
                })
            };
        }).filter(function(report) {
            return report.nodes.length > 0;
        });
        console.log(JSON.stringify(report));
    }
}

function reportJS(shell, path) {
    reportScripts(shell, [fs.readFileSync(path)]);
}

function reportXPI(shell, path) {
    var scripts = [];

    var xpi = new XPI(path, { checkSyntax: false });

    xpi.on("script", function(script) { scripts.push(script) })
       .on("end", function() {
           reportScripts(shell, scripts);
       });
}

function report(shell, path) {
    if (/\.((xpi)|(jar)|(zip))$/.test(path))
        reportXPI(shell, path)
    else
        reportJS(shell, path);
}

exports.report = report;
