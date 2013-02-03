# istanbul-proxy

Run Istanbul coverage on JS in the browser through an HTTP proxy

## Getting Started

1. Install the module with: `npm install -g istanbul-proxy`
2. Run istanbul-proxy
3. Set your browser up to use the local port that istanbul-proxy is running on as a proxy server.
4. Hit the urls you want to get coverage for
5. Visit the istanbul-proxy server directly to view coverage reports (or view the static files in the reportDir).

```
> istanbul-proxy --help

  Usage: istanbul-proxy [options]

  Options:

    -h, --help                       output usage information
    -V, --version                    output the version number
    -p, --port [port]                The HTTP port to listen on
    -r, --reportDir [path]           The directory in which to write HTML report
                                     ing files.
    -t, --reportingTimeout [millis]  How long after window.onload the coverage
                                     report should be reported to the server. If
                                     set to 0, coverage will not be reported.
                                     Your pages must then call
                                     istanbulProxy.sendReport() when finished.
    -n, --passThroughUrls [urls]     URLs that should not be instrumented
```

## Examples

```
> istanbul-proxy -p 6984 -r C:\Data\proxy-test
HTML reporting files will be stored in C:\Data\proxy-test
Proxy server running on port 6984
```

## Contributing
In lieu of a formal styleguide, take care to maintain the existing coding style. Add unit tests for any new or changed functionality. Lint and test your code using [grunt](https://github.com/gruntjs/grunt).

## Release History
0.1.0 - Initial release.

## License
Copyright (c) 2013 Adam Ahmed  
Licensed under the MIT license.
