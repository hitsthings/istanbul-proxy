window.onload = function() {
    setTimeout(function() {
        istanbulProxy.sendReport();
    }, %TIMEOUT%);
};
