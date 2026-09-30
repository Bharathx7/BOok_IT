const fs = require("fs");
const path = require("path");

module.exports = (request, options) => {
  if (request.endsWith(".js")) {
    const tsRequest = request.slice(0, -3) + ".ts";

    try {
      const candidate = path.resolve(options.basedir, tsRequest);

      if (fs.existsSync(candidate)) {
        return options.defaultResolver(tsRequest, options);
      }
    } catch {
      // Fall back to normal resolution
    }
  }

  return options.defaultResolver(request, options);
};