'use strict';

const utils = require('./utils');
const visit = require('./walk');

module.exports = (ast, options = {}) => {
  const stringify = function* (node, parent = {}) {
    const invalidBlock = options.escapeInvalid && utils.isInvalidBrace(parent);
    const invalidNode = node.invalid === true && options.escapeInvalid === true;
    let output = '';

    if (node.value) {
      if ((invalidBlock || invalidNode) && utils.isOpenOrClose(node)) {
        return '\\' + node.value;
      }
      return node.value;
    }

    if (node.value) {
      return node.value;
    }

    if (node.nodes) {
      for (const child of node.nodes) {
        output += yield [child];
      }
    }
    return output;
  };

  return visit(stringify, ast);
};
