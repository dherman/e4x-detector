var fs = require('fs');
var XPI = require('xpi');
var sm = require('spidermonkey');

function children(node) {
    switch (node.type) {
      case 'EmptyStatement':
      case 'DebuggerStatement':
      case 'ThisExpression':
      case 'GraphIndexExpression':
      case 'Identifier':
      case 'Literal':
      case 'UnaryOperator':
      case 'BinaryOperator':
      case 'LogicalOperator':
      case 'AssignmentOperator':
      case 'UpdateOperator':
      case 'XMLAnyName':
      case 'XMLText':
      case 'XMLAttribute':
      case 'XMLCdata':
      case 'XMLComment':
      case 'XMLProcessingInstruction':
        return [];

      case 'Program':
      case 'BlockStatement':
        return node.body;

      case 'ExpressionStatement':
      case 'GraphExpression':
      case 'XMLEscape':
        return [node.expression];

      case 'IfStatement':
      case 'ConditionalExpression':
        return [node.test, node.consequent, node.alternate];

      case 'LabeledStatement':
        return [node.body];

      case 'BreakStatement':
      case 'ContinueStatement':
        return [node.label];

      case 'WithStatement':
        return [node.object, node.body];

      case 'SwitchStatement':
        return [node.discriminant].concat(node.cases);

      case 'ReturnStatement':
      case 'ThrowStatement':
      case 'YieldExpression':
        return [node.argument];

      case 'TryStatement':
        return [node.block, node.finalizer].concat(node.handlers);

      case 'WhileStatement':
      case 'DoWhileStatement':
        return [node.test, node.body];

      case 'ForStatement':
        return [node.init, node.test, node.update, node.body];

      case 'ForInStatement':
        return [node.left, node.right, node.body];

      case 'LetStatement':
        return [node.body].concat(node.head);

      case 'FunctionDeclaration':
        return [node.id, node.body].concat(node.params);

      case 'VariableDeclaration':
        return node.declarations;

      case 'VariableDeclarator':
        return [node.id, node.init];

      case 'ArrayExpression':
        return node.elements;

      case 'ObjectExpression':
        return node.properties;

      case 'Property':
        return [node.key, node.value];

      case 'FunctionExpression':
        return [node.id, node.body].concat(node.params);

      case 'SequenceExpression':
        return node.expressions;

      case 'UnaryExpression':
        return [node.operator, node.argument];

      case 'BinaryExpression':
      case 'AssignmentExpression':
      case 'LogicalExpression':
        return [node.operator, node.left, node.right];

      case 'UpdateExpression':
        return [node.operator, node.argument];

      case 'NewExpression':
        return [node.constructor].concat(node.arguments || []);

      case 'CallExpression':
        return [node.callee].concat(node.arguments);

      case 'MemberExpression':
        return [node.object, node.property];

      case 'ComprehensionExpression':
      case 'GeneratorExpression':
        return [node.filter].concat(node.blocks);

      case 'LetExpression':
        return [node.body].concat(node.head);

      case 'ObjectPattern':
        return node.properties;

      case 'ArrayPattern':
        return node.elements;

      case 'SwitchCase':
        return [node.test].concat(node.consequent);

      case 'CatchClause':
        return [node.param, node.guard, node.body];

      case 'ComprehensionBlock':
      case 'XMLQualifiedIdentifier':
      case 'XMLFilterExpression':
        return [node.left, node.right];

      case 'XMLDefaultDeclaration':
        return [node.namespace];

      case 'XMLFunctionQualifiedIdentifier':
        return [node.right];

      case 'XMLAttributeSelector':
        return [node.attribute];

      case 'XMLElement':
      case 'XMLList':
      case 'XMLStartTag':
      case 'XMLEndTag':
      case 'XMLPointTag':
        return node.contents;

      case 'XMLName':
        return typeof node.contents === "string"
             ? []
             : node.contents;
    }
}

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
        var kids = children(node);
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
