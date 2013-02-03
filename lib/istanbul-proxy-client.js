var istanbulProxy = (function() {

    var reportId = new Date().getTime();

    function sendReport() {
        if (window.XMLHttpRequest) {
            var xhr = new XMLHttpRequest();
            xhr.open("POST", "/istanbul", true);
            xhr.onreadystatechange = function () {
              if (xhr.readyState != 4) return;
              if (xhr.status != 200) return console.log('Failed to report coverage. Status code: ' + xhr.status);
              return console.log('Coverage reported.');
            };
            xhr.send(JSON.stringify({
                coverage: window.__coverage__ || null,
                url : location.href
            }));
        } else {
            window.console && console.log && console.log("XMLHttpRequest required to send coverage report.");
        }
    }

    return {
        sendReport : sendReport 
    };
}());
