var http = require('http');
var fs = require('fs');
var path = require('path');
var url = require('url');
var querystring = require('querystring');
var os = require('os');
var dns = require('dns');

var connect = require('connect');

var url2path = require('url2path');

var temp = require('temp');

var mkdirp = require('mkdirp');

var istanbul = require('istanbul');
var Instrumenter = istanbul.Instrumenter;
var Collector = istanbul.Collector;
var Report = istanbul.Report;
var Store = istanbul.Store;


function isMyIp(ip) {
    var networkInterfaces = os.networkInterfaces();
    return Object.keys(networkInterfaces).some(function(interfaceType) {
        var interfacesOfType = networkInterfaces[interfaceType];
        return interfacesOfType && interfacesOfType.some(function(networkInterface) {
            return networkInterface.address === ip;
        });
    });
}

var hostnameCache = {};
function isMyHostname(hostname, cb) {
    if (hostnameCache[hostname]) {
        return cb(null, hostnameCache[hostname]);
    }
    dns.lookup(hostname, function(err, address) {
        if (err) return cb(err);
        return cb(null, hostnameCache[hostname] = isMyIp(address));
    });
}

function isType(mimeRE, urlRE) {
    return function(req, res) {
        if (res.headers['content-type']) {
            return mimeRE.test(res.headers['content-type']);
        }
        return urlRE.test(req.url);
    };
}
var isJs = isType(/javascript/, /\.js\s*$/);
var isHtml = isType(/html/, /\.(htm(l?)|asp(x?)|php|jsp)\s*$/);

var istanbulClientScript;
var sendReportScript;
function getReportingScript(timeout) {
    if (!istanbulClientScript) {
        istanbulClientScript = fs.readFileSync( path.join(__dirname, 'istanbul-proxy-client.js'), 'utf8' );
    }

    if (!timeout) {
        return istanbulClientScript;
    }

    if (!sendReportScript) {
        sendReportScript = fs.readFileSync( path.join(__dirname, 'send-report-client.js'), 'utf8' );
    }

    return istanbulClientScript + sendReportScript.replace('%TIMEOUT%', timeout);
}

function insertReporter(htmlSource, reportingTimeout) {
    // insert before first script, or before the end of head, or just at the top
    var insertMatch = /<script>|<\/head>/.exec(htmlSource);
    var insertIndex = insertMatch && insertMatch.index || 0;

    return htmlSource.substring(0, insertIndex) +
        "<script>" + getReportingScript(reportingTimeout) + "</script>" +
        htmlSource.substring(insertIndex);
}

function proxy(req, res, getProxyResponseTransform) {
    var options = url.parse(req.url);
    options.headers = req.headers;
    options.method = req.method;

    var proxy_req = http.request(options, (getProxyResponseTransform || cleanResponse)(req, res));
    req.on('data', function(chunk) {
        proxy_req.write(chunk, 'binary');
    });
    req.on('end', function() {
      proxy_req.end();
    });
}

function instrumentationResponse(options, req, res) {
    return function (proxy_res) {
        var needsReport = isHtml(req, proxy_res);
        var needsInstrumentation = ~options.instrumentUrls.indexOf(req.url) || isJs(req, proxy_res);
        var responseStr = "";

        proxy_res.on('data', needsReport || needsInstrumentation ?
            function(chunk) { responseStr += chunk; } :
            function(chunk) { res.write(chunk, 'binary'); }
        );

        proxy_res.on('end', function() {
            if (needsInstrumentation) {
                var instrumented = instrument(responseStr, req.url, options);
                proxy_res.headers['content-length'] = instrumented.length;
                res.writeHead(proxy_res.statusCode, proxy_res.headers);
                res.write(instrumented,'binary');
            }
            if (needsReport) {
                res.writeHead(proxy_res.statusCode, proxy_res.headers);
                res.write(options.reportingTimeout && insertReporter(responseStr, options.reportingTimeout));
            } else {
              res.writeHead(proxy_res.statusCode, proxy_res.headers);
            }
            res.end();
        });
    };
}

function instrument(source, sourceUrl, options) {
    //extract onth path from url
    var parse_url = /^(?:([A-Za-z]+):)?(\/{0,3})([0-9.\-A-Za-z]+)(?::(\d+))?(?:\/([^?#]*))?(?:\?([^#]*))?(?:#(.*))?$/;
    var result = parse_url.exec(sourceUrl);
    var filepath = result[5];
    options.sourceStore.set(filepath, source);
    return options.instrumenter.instrumentSync(source, filepath);
}

function proxyThroughInstrumentation(req, res, options) {
    return proxy(req, res, instrumentationResponse.bind(null, options));
}

function cleanResponse(req, res) {
    return function (proxy_res) {
        proxy_res.on('data', function(chunk) { 
          res.write(chunk, 'binary'); 
        });
        proxy_res.on('end', res.end.bind(res));
        res.writeHead(proxy_res.statusCode, proxy_res.headers);
    };
}

module.exports = function(options) {
    options = options || {};

    var instrumenter = options.instrumenter = new Instrumenter({
        embedSource : true // we only have URLs to work with, so can't get the source from disk.
    });
    var collector = options.collector = new Collector();
    var sourceStore = options.sourceStore = Store.create('memory');

    var port = options.port = parseInt(options.port || 8080, 10);
    var reportDir = options.reportDir = options.reportDir || temp.mkdirSync();
    var reportingTimeout = options.reportingTimeout = options.reportingTimeout === undefined ?
        1000 :
        parseInt(options.reportingTimeout || 0, 10);
    var includeRegex = typeof options.includeRegex==="string" ? new RegExp(options.includeRegex,"g") : /./

    // These urls are used by the istanbul reporter, and shouldn't be instrumented.
    var passThroughUrls = options.passThroughUrls = [
        'http://yui.yahooapis.com/3.6.0/build/yui/yui-min.js',
        'http://yui.yahooapis.com/combo?3.6.0/build/widget-uievents/widget-uievents-min.js&3.6.0/build/datatable-base/datatable-base-min.js&3.6.0/build/datatable-column-widths/datatable-column-widths-min.js&3.6.0/build/intl/intl-min.js&3.6.0/build/datatable-message/lang/datatable-message_en.js&3.6.0/build/datatable-message/datatable-message-min.js&3.6.0/build/datatable-mutable/datatable-mutable-min.js&3.6.0/build/datatable-sort/lang/datatable-sort_en.js&3.6.0/build/datatable-sort/datatable-sort-min.js&3.6.0/build/plugin/plugin-min.js&3.6.0/build/datasource-local/datasource-local-min.js&3.6.0/build/datatable-datasource/datatable-datasource-min.js',
        'http://yui.yahooapis.com/combo?3.6.0/build/node-core/node-core-min.js&3.6.0/build/node-base/node-base-min.js&3.6.0/build/event-base/event-base-min.js&3.6.0/build/event-delegate/event-delegate-min.js&3.6.0/build/node-event-delegate/node-event-delegate-min.js&3.6.0/build/datatable-core/datatable-core-min.js&3.6.0/build/view/view-min.js&3.6.0/build/classnamemanager/classnamemanager-min.js&3.6.0/build/datatable-head/datatable-head-min.js&3.6.0/build/datatable-body/datatable-body-min.js&3.6.0/build/datatable-table/datatable-table-min.js&3.6.0/build/pluginhost-base/pluginhost-base-min.js&3.6.0/build/pluginhost-config/pluginhost-config-min.js&3.6.0/build/base-pluginhost/base-pluginhost-min.js&3.6.0/build/event-synthetic/event-synthetic-min.js&3.6.0/build/event-focus/event-focus-min.js&3.6.0/build/dom-style/dom-style-min.js&3.6.0/build/node-style/node-style-min.js&3.6.0/build/widget-base/widget-base-min.js&3.6.0/build/widget-htmlparser/widget-htmlparser-min.js&3.6.0/build/widget-skin/widget-skin-min.js',
        'http://yui.yahooapis.com/combo?3.6.0/build/escape/escape-min.js&3.6.0/build/array-extras/array-extras-min.js&3.6.0/build/array-invoke/array-invoke-min.js&3.6.0/build/arraylist/arraylist-min.js&3.6.0/build/attribute-core/attribute-core-min.js&3.6.0/build/base-core/base-core-min.js&3.6.0/build/oop/oop-min.js&3.6.0/build/event-custom-base/event-custom-base-min.js&3.6.0/build/event-custom-complex/event-custom-complex-min.js&3.6.0/build/attribute-events/attribute-events-min.js&3.6.0/build/attribute-extras/attribute-extras-min.js&3.6.0/build/attribute-base/attribute-base-min.js&3.6.0/build/attribute-complex/attribute-complex-min.js&3.6.0/build/base-base/base-base-min.js&3.6.0/build/base-build/base-build-min.js&3.6.0/build/json-parse/json-parse-min.js&3.6.0/build/model/model-min.js&3.6.0/build/model-list/model-list-min.js&3.6.0/build/dom-core/dom-core-min.js&3.6.0/build/dom-base/dom-base-min.js&3.6.0/build/selector-native/selector-native-min.js&3.6.0/build/selector/selector-min.js'
    ].concat(options.passThroughUrls || []);
    // These urls may not match the mime type or URL regex, but should be instrumented anyway
    var instrumentUrls = options.instrumentUrls = options.instrumentUrls || [];



    var isDirty = true;
    function reportCoverage(coverageJSON, coverageUrl) {
        // the "testName" parameter isn't currently used by istanbul, but passing in a value
        // anyway in case it gets used in the future.
        collector.add(coverageJSON, coverageUrl);
        isDirty = true;
    }

    function writeReport(cb) {
        if (isDirty) {
            Report.create('html', {
                dir : reportDir,
                sourceStore: sourceStore,
                verbose: false
            }).writeReport(collector, !!'sync');
            Report.create('cobertura', {
                dir : reportDir,
                sourceStore: sourceStore,
                verbose: false
            }).writeReport(collector, !!'sync');
        }
        isDirty = false;
        cb && cb();
    }

    var staticServer;
    mkdirp(reportDir, function() {
        staticServer = connect.static(reportDir);
    });
    function viewReport(req, res) {
        writeReport(function() {
            staticServer(req, res, function(err) {
                if (err) return handleErr(res, e, 500);
                res.writeHead(404);
                res.end();
            });
        });
    }

    function handleOwnRequest(req, res) {
        viewReport(req, res);
    }

    function handleUserError(res, e) {
        handleErr(res, e, 400);
    }
    function handleErr(res, e, status) {
        console.log(e);
        res.writeHead(status || 400, { 'content-type' : 'text/plain' });
        res.write(e && e.getMessage ? e.getMessage() : e);
        res.end();
    }

    function handleKnownHostRequest(isOwnRequest, req, res) {
        if (isOwnRequest) {
            handleOwnRequest(req, res);
        } else if (req.method === 'POST' && url.parse(req.url).pathname === '/istanbul') {
            var reqBody = '';
            req.on('data', function(chunk) { reqBody += chunk; });
            req.on('end', function() {
                var json;
                try {                
                    json = JSON.parse(reqBody);
                    if (json) {
                        reportCoverage(json.coverage || {}, json.url);
                    }
                } catch (e) {
                    return handleUserError(res, e);
                }
                res.writeHead(200);
                res.end();
            });
        } else {
            proxyThroughInstrumentation(req, res, options); 
        }
    }

   
    http.createServer(function(req, res) {
        if (~passThroughUrls.indexOf(req.url)) {
            return proxy(req, res);
        }
        
        var hostAndPort = req.headers['host'].split(':');
        var parsedPort = parseInt(hostAndPort[1] || 0, 10);
        var isMyPort = parsedPort === port || (port === 80 && !parsedPort);
        
        if (!isMyPort) {
            if (!req.url.match(includeRegex) && !req.url.match(/istanbul$/)) {
              return proxy(req, res);
            } else {
              console.log(req.url);
              return handleKnownHostRequest(false, req, res);
            }
        }
        isMyHostname(hostAndPort[0], function(err, isMyHostname) {
            if (err) {
                console.log(err);
                res.writeHead(500);
                res.end();
                return;
            }
            console.log(req.url);
            handleKnownHostRequest(isMyHostname, req, res);
        });
    }).listen(port, function() {
        console.log('Proxy server running on port ' + port);
    })

    process.on('SIGINT', function() {
      writeReport(function() {
        console.log("Report writed to exit.");
        process.exit(0);
      });
    });

    console.log('HTML reporting files will be stored in ' + reportDir);
    if (!reportingTimeout) {
        console.log('Coverage is not being automatically reported to the server. Call istanbulProxy.sendReport() manually.');
    }    
};
