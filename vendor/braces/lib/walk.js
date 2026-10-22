'use strict';

// Run recursive AST visitors on a heap stack instead of the JavaScript call stack.
module.exports = (visit, ...args) => {
  const stack = [visit(...args)];
  let value;
  while (stack.length > 0) {
    const result = stack[stack.length - 1].next(value);
    if (result.done) {
      stack.pop();
      value = result.value;
    } else {
      stack.push(visit(...result.value));
      value = undefined;
    }
  }
  return value;
};
