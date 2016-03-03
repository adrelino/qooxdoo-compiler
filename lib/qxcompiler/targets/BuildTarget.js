/* ************************************************************************
 *
 *    qxcompiler - node.js based replacement for the Qooxdoo python
 *    toolchain
 *
 *    https://github.com/johnspackman/qxcompiler
 *
 *    Copyright:
 *      2011-2013 Zenesis Limited, http://www.zenesis.com
 *
 *    License:
 *      LGPL: http://www.gnu.org/licenses/lgpl.html
 *      EPL: http://www.eclipse.org/org/documents/epl-v10.php
 *
 *      This software is provided under the same licensing terms as Qooxdoo,
 *      please see the LICENSE file in the Qooxdoo project's top-level directory
 *      for details.
 *
 *    Authors:
 *      * John Spackman (john.spackman@zenesis.com)
 *
 * ************************************************************************/

var fs = require("fs");
var path = require("path");
var qx = require("qooxdoo");
var async = require("async");
var util = require("../../util");
var UglifyJS = require("uglify-js");

var log = util.createLog("target");

require("./Target");

/**
 * Compiles a "build" application, minified and self contained application
 */
module.exports = qx.Class.define("qxcompiler.targets.BuildTarget", {
  extend: qxcompiler.targets.Target,

  properties: {
    /** Whether to minify the output */
    minify: {
      init: true,
      nullable: false,
      check: "Boolean"
    }
  },

  members: {
    _packageUris: null,

    /*
     * @Override
     */
    _writeApplication: function(compileInfo, cb) {
      var _arguments = arguments;
      var application = compileInfo.application;
      var t = this;
      t._packageUris = {};
      async.forEachOfSeries(compileInfo.configdata.loader.packages,
          function(package, pkgId, cb) {
            var uris = t._uris;
            t._packageUris[pkgId] = package.uris;
            package.uris = [];
          });

      var libraries = this.getAnalyser().getLibraries();
      var libraryLookup = {};
      libraries.forEach(function(library) {
        libraryLookup[library.getNamespace()] = library;
        compileInfo.configdata.libraries[library.getNamespace()] = {
          sourceUri: application.getName(),
          resourceUri: "resource"
        };
      });

      var queue = async.queue(
          function(asset, cb) {
            var library = libraryLookup[asset.libraryName];
            qxcompiler.files.Utils.sync(
                library.getRootDir() + "/" + library.getResourcePath() + "/" + asset.filename,
                t.getOutputDir() + "/resource/" + asset.filename,
                cb);
          },
          100
      );
      queue.drain = function(err) {
        if (err)
          return cb(err);
        t.base(_arguments, compileInfo, cb);
      };
      queue.push(compileInfo.assets);
    },

    /*
     * @Override
     */
    _writeBootJs: function(compileInfo, writeStream, cb) {
      var t = this;
      var application = compileInfo.application;
      var analyser = this.getAnalyser();

      async.forEachOfSeries(t._packageUris,
          function(uris, pkgId, cb) {
            async.eachSeries(uris,
                function (uri, cb) {
                  var m = uri.match(/^([^:]+):(.*$)/);
                  var namespace = m[1];
                  var path = m[2];
                  var rs = null;
                  if (namespace == "__out__")
                    rs = fs.createReadStream(path.normalize(t.getOutputDir() + "/" + application.getName() + "/" + path));
                  else
                    rs = fs.createReadStream(path.normalize(t.getOutputDir() + "/transpiled/" + path));
                  rs.on('end', function () {
                    writeStream.write("\n");
                    cb();
                  });
                  rs.on('data', function (chunk) {
                    writeStream.write(chunk);
                  });
                },
                function (err) {
                  if (err)
                    return cb(err);
                  cb();
                });
          },
          cb);
    },

    _afterWriteApplication: function(compileInfo, cb) {
      var t = this;
      var application = compileInfo.application;
      var appRootDir = this.getOutputDir() + "/";
      var bootJs = path.normalize(appRootDir + application.getName() + "/" + t.getScriptPrefix() + "boot.js");
      var uncompressedJs = path.normalize(appRootDir + application.getName() + "/" + t.getScriptPrefix() + "uncompressed.js");

      fs.unlink(uncompressedJs, function(err) {
        if (err && err.code != "ENOENT")
          return cb(err);
        fs.rename(bootJs, uncompressedJs, function(err) {
          if (err)
            return cb(err);
          var result = UglifyJS.minify([uncompressedJs]);
          fs.writeFile(bootJs, result.code, { encoding: "utf8" }, cb);
          /*
          fs.readFile(uncompressedJs, { encoding: "utf8" }, function(err, code) {

            var options = {
              mangle: {},
              compress: {}
            }

            try {
              var output = UglifyJS.OutputStream({
                beautify: false,
                quote_style: 0
              });
              var compressor = options.compress && UglifyJS.Compressor(options.compress);
            } catch(ex) {
              if (ex instanceof UglifyJS.DefaultsError) {
                print_error(ex.msg);
                print_error("Supported options:");
                print_error(sys.inspect(ex.defs));
                process.exit(1);
              }
            }

            try {
              var TOPLEVEL = UglifyJS.parse(code, {
                filename     : uncompressedJs
              });
            } catch(ex) {
              if (ex instanceof UglifyJS.JS_Parse_Error) {
                print_error("Parse error at " + file + ":" + ex.line + "," + ex.col);
                print_error(ex.message);
                print_error(ex.stack);
                process.exit(1);
              }
              throw ex;
            }

            TOPLEVEL.figure_out_scope();
            TOPLEVEL.scope_warnings();

            TOPLEVEL = TOPLEVEL.transform(compressor);

            TOPLEVEL.figure_out_scope();
            if (options.mangle) {
              TOPLEVEL.compute_char_frequency(options.mangle);
            }

            if (options.mangle) {
              TOPLEVEL.mangle_names(options.mangle);
            }

            TOPLEVEL.print(output);
            output = output.get();

            fw.writeFile(bootJs, output, { encoding: "utf8" }, cb);
          });
          */
        });
      });
    },

    /*
     * @Override
     */
    toString: function() {
      return "Build Target: " + this.getOutputDir();
    }
  }
});


