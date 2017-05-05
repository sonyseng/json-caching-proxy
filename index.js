const fs = require('fs');
const rimraf = require('rimraf');
const path = require('path');
const mkdirp = require('mkdirp');
const express = require('express');
const proxy = require('express-http-proxy');
const request = require('request');
const url = require('url');
const chalk = require('chalk');

const responseFileName = 'response.json';

function jsonCachingProxy (options, isDebugging) {
  // Destructure options
  let {
    remoteServerUrl,
    proxyPort,
    cacheDataDirectory,
    middlewareList,
    commandPrefix='proxy',
    proxyHeaderIdentifier = 'json-cached-proxy-playback',

    dataPlayback = true,
    dataRecord = true,
    dataOverwrite = false
  } = options;

  let app = express();
  let currentWorkingDir = process.cwd();
  let server, printLog, printError;

  if (isDebugging) {
    printLog = console.log;
    printError = console.error;
  } else {
    printLog = () => false;
    printError = () => false;
  }

  let persistResponseData = (directory, fileName, responseStr) => {
    let responseFilePath = path.join(directory, fileName);

    printLog(chalk.yellow('Saving to File Cache', chalk.bold(responseFilePath)));

    mkdirp(directory, function (err) {
      if (err) {
        printError(chalk.red(err));
      } else {
        fs.writeFile(responseFilePath, responseStr, function (err) {
          if (err) {
            printError(chalk.red(err));
            return;
          }
        });
      }
    });
  };

  let readResponseData = (directory, callback) => {
    let responseFilePath = path.join(directory, responseFileName);

    printLog(chalk.green('Reading From Cache', chalk.bold(responseFilePath)));

    fs.readFile(responseFilePath, 'utf-8', function read(err, responseData) {
      if (!err) {
        callback && callback(responseData);
      }
    });
  };

  // These are not really restful because the GET is changing state. But it's easier to use in a browser
  app.use(`/${commandPrefix}/playback`, function (req, res) {
    dataPlayback = typeof req.query.enabled !== 'undefined' ? req.query.enabled === 'true'.toLowerCase() : dataPlayback;
    printLog(chalk.blue(`Replay from cache: ${dataPlayback}`));
    res.send(`Replay from cache: ${dataPlayback}`);
  });

  app.use(`/${commandPrefix}/record`, function (req, res) {
    dataRecord = typeof req.query.enabled !== 'undefined' ? req.query.enabled === 'true'.toLowerCase() : dataRecord;
    printLog(chalk.blue('Saving to cache: ' + dataRecord));
    res.send(`Saving to cache: ${dataRecord}`);
  });

  app.use(`/${commandPrefix}/overwrite`, function (req, res) {
    dataOverwrite = typeof req.query.enabled !== 'undefined' ? req.query.enabled === 'true'.toLowerCase() : dataOverwrite;
    printLog(chalk.blue('Overwrite existing cache: ' + dataOverwrite));
    res.send(`Overwrite existing cache: ${dataOverwrite}`);
  });

  app.use(`/${commandPrefix}/clear`, function (req, res) {
    rimraf(path.join(currentWorkingDir, cacheDataDirectory), function () {
      printLog(chalk.blue('Cleared cache'));
      res.send('Cleared cache');
    });
  });

  // User supplied middleware to handle special cases (browser-sync middleware options)
  if (middlewareList && middlewareList.length > 0) {
    middlewareList.forEach((mw) => {
      if (mw.route) {
        app.use(mw.route, mw.handle);
      } else {
        app.use(mw.handle);
      }
    });
  }

  app.use('/', function (req, res, next) {
    let resource = req.path;

    if (!dataOverwrite && dataPlayback) {
      let queryParamPath = Object.keys(req.query).map(key => key === '_' ? '' : `${key}/${req.query[key]}`).join('/');
      let directory = path.join(currentWorkingDir, cacheDataDirectory, resource, queryParamPath);

      // Read from a file if it exists
      fs.stat(directory, function (err) {
        if (!err) {
          readResponseData(directory, function (responseData) {
            res.setHeader('content-type', 'application/json;charset=UTF-8');
            res.setHeader(proxyHeaderIdentifier, 'true');
            res.send(responseData);
          });
        } else {
          printLog(chalk.gray('Proxied Resource', req.path));
          next();
        }
      });
    } else {
      printLog(chalk.gray('_Proxied Resource', req.path));
      next();
    }
  });

  // Persist JSON data when needed
  app.use('/', proxy(remoteServerUrl, {
    intercept: function (rsp, data, req, res, callback) {
      if (dataRecord) {
        let contentType = res.header()._headers['content-type'];

        if (contentType && contentType.indexOf('application/json') >= 0) {
          let resource = req.path;
          let queryParamPath = Object.keys(req.query).map(key => key === '_' ? '' : `${key}/${req.query[key]}`).join('/');
          let directory = path.join(currentWorkingDir, cacheDataDirectory, resource, queryParamPath);

          if (dataOverwrite) {
            // Always create data even if the file exists
            persistResponseData(directory, responseFileName, data.toString('utf8'));
          } else {
            // Only create new files
            fs.stat(path.join(directory, responseFileName), function (err) {
              if (err && err.code === 'ENOENT') {
                persistResponseData(directory, responseFileName, data.toString('utf8'));
              }
            });
          }
        }

        // Handle Redirects
        let location = res.get('location');
        if (location) {
          res.location(url.parse(location).path);
        }
      }

      callback(null, data);
    }
  }));

  return {
    start: function () {
      server = app.listen(proxyPort);
      printLog(chalk.bold(`\nStarting Proxy Server:`));
      printLog(chalk.gray(`======================\n`));
      printLog(`Remote Server URL: ${chalk.bold(remoteServerUrl)}`);
      printLog(`Proxy running on port: ${chalk.bold(proxyPort)}`);
      printLog(`Persisting JSON to: ${chalk.bold(path.join(currentWorkingDir, cacheDataDirectory))}`);
      printLog(`Cached Playback: ${chalk.bold(dataPlayback)}`);
      printLog(`Cache persistence: ${chalk.bold(dataRecord)}`);
      printLog(`Always Overwrite cache: ${chalk.bold(dataOverwrite)}`);
      printLog(`Command Prefix: ${chalk.bold(commandPrefix)}`);
      printLog(`Response header ID: ${chalk.bold(proxyHeaderIdentifier)}\n`);
      return app;
    },

    stop: function () {
      if (server) {
        server.close();
        printLog(chalk.bold('\nStopping Proxy Server'));
      }
    },

    getServer: function () {
      return server;
    },

    getExpressApp: function () {
      return app;
    },

    isReplaying: function () {
      return dataPlayback
    },

    isRecording: function () {
      return dataRecord;
    },

    isOverwriting: function () {
      return dataOverwrite;
    }
  }
}

module.exports = jsonCachingProxy;



