// jsdom + the Fetch API classes Node already ships (jsdom does not implement them). React Router 8 needs them.
const { TestEnvironment } = require('jest-environment-jsdom');

class JsdomWithFetchApi extends TestEnvironment {
  constructor(config, context) {
    super(config, context);
    Object.assign(this.global, {
      Request,
      Response,
      Headers,
      FormData,
      AbortController,
      AbortSignal,
      ReadableStream,
      TextEncoder,
      TextDecoder,
      structuredClone,
    });
  }
}
module.exports = JsdomWithFetchApi;
