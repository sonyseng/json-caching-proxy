const assert = require('assert');
const fs = require('fs');
const mockFs = require('mock-fs');
const fetch = require('node-fetch');
const express = require('express');
const JsonCachingProxy = require('./');

const mockServerPort = 8118;
const proxyPort = 8119;
const proxyServerUrl = 'http://localhost:'+ proxyPort;
const cacheDataDirectory = 'cache';

function jsonFetch(url) {
  return fetch(url, { headers: { 'Accept': 'application/json, text/plain, */*', 'Content-Type': 'application/json'} });
}

describe('JSON-caching-proxy', () => {
  let mockApp = express();
  let mockRemoteServer, proxy;
  let mockJson, mockText, mockOptions;

  before(() => {
    mockJson = { a: 1, b: 'Some Value' };
    mockText = '<div>My Div</div>';

    mockRemoteServer = mockApp.listen(mockServerPort);
    mockApp.use('/test', (req, res) => res.json(mockJson));
    mockApp.use('/test_no_json', (req, res) => res.send(mockText));

    // Use a Virtual File system instead of the real File system
    mockFs({ cacheDataDirectory: {} });

    mockOptions = {
      remoteServerUrl: 'http://localhost:' + mockServerPort,
      proxyPort: proxyPort,
      harObject: null,
      commandPrefix: 'proxy',
      proxyHeaderIdentifier: 'caching-proxy-playback',
      middlewareList: [
        { route: '/what', handle: (req, res, next) => res.send('what') },
        { route: '/hello', handle: (req, res, next) => res.send('hello') }
      ],
      excludedRouteMatchers: [],
      cacheBustingParams: [],
      cacheEverything: false,
      dataPlayback: true,
      dataRecord: true,
      showConsoleOutput: false
    };
  });

  after(() => {
    mockFs.restore();
    mockRemoteServer.close();
  });

  beforeEach(() => {
    proxy = new JsonCachingProxy(mockOptions);
    proxy.start();
  });

  afterEach(() => {
    proxy.stop();
  });

  //it('proxies and caches JSON', done => {
  //  jsonFetch(proxyServerUrl +'/test')
  //    .then(res => res.json())
  //    .then(json => assert.deepEqual(json, mockJson))
  //    .then(() => jsonFetch(proxyServerUrl + '/test'))
  //    .then(res => res.json())
  //    .then(json => assert.deepEqual(json, mockJson))
  //    .then(() => {
  //      // File should exist
  //      return fs.stat(cacheDataDirectory + '/test/response.json', (err) => {
  //        assert(!err);
  //        done();
  //      });
  //    });
  //});
	//
  //it('does not proxy non-JSON content types', done => {
  //  jsonFetch(proxyServerUrl +'/test_no_json')
  //    .then(res => res.text())
  //    .then(text => assert.equal(text, mockText))
  //    .then(() => {
  //      // File should not exist
  //      return fs.stat(cacheDataDirectory + '/test_no_json/response.json', (err) => {
  //        assert(err);
  //        done();
  //      });
  //    });
  //});
	//
  //it('calls user-defined express middleware: /what', done => {
  //  jsonFetch(proxyServerUrl +'/what')
  //    .then(res => res.text())
  //    .then(text => assert.equal(text, 'what'))
  //    .then(() => {
  //      // File should not exist
  //      return fs.stat(cacheDataDirectory + '/what/response.json', (err) => {
  //        assert(err);
  //        done();
  //      });
  //    });
  //});
	//
  //it('calls user-defined express middleware: /hello', done => {
  //  jsonFetch(proxyServerUrl +'/hello')
  //    .then(res => res.text())
  //    .then(text => assert.equal(text, 'hello'))
  //    .then(() => {
  //      // File should not exist
  //      return fs.stat(cacheDataDirectory + '/hello/response.json', (err) => {
  //        assert(err);
  //        done();
  //      });
  //    });
  //});
	//
  //it('disables playback from cache', () => {
  //  return jsonFetch(proxyServerUrl + '/test')
  //    .then(() => jsonFetch(proxyServerUrl + '/test')) // Cached the request
  //    .then((res) => {
  //      assert(res.headers.get(proxyHeaderIdentifier)); // Special Proxy cached header sent
  //      assert(proxy.isReplaying());
  //    })
  //    .then(() => jsonFetch(proxyServerUrl +'/'+ commandPrefix +'/playback?enabled=false'))
  //    .then(() => jsonFetch(proxyServerUrl + '/test'))
  //    .then((res) => {
  //      // Special Proxy cached header not sent
  //      assert(!res.headers.get(proxyHeaderIdentifier));
  //      assert(!proxy.isReplaying());
  //    });
  //});
	//
  //it('clears cache', done => {
  //  jsonFetch(proxyServerUrl + '/test')
  //    .then(() => jsonFetch(proxyServerUrl + '/test')) // Cached the request
  //    .then((res) => {
  //      // Special Proxy cached header sent to signify playback from file
  //      assert(res.headers.get(proxyHeaderIdentifier));
  //      assert(proxy.isReplaying());
  //    })
  //    .then(() => jsonFetch(proxyServerUrl +'/'+ commandPrefix +'/clear'))
  //    .then(() => jsonFetch(proxyServerUrl + '/test'))
  //    .then((res) => {
  //      assert(!res.headers.get(proxyHeaderIdentifier));  // Special Proxy cached header not sent
  //    })
  //    .then(() => {
  //      // File should exist
  //      return fs.stat(cacheDataDirectory + '/test/response.json', (err) => {
  //        assert(!err);
  //        done();
  //      });
  //    });
  //});
	//
  //it('enables cache overwriting', done => {
  //  jsonFetch(proxyServerUrl + '/test')
  //    .then(() => mockJson.a = mockJson.a + 10) // Increment the value and sees if it comes back from the cache
  //    .then(() => jsonFetch(proxyServerUrl + '/test'))
  //    .then(res => res.json())
  //    .then(json => assert(json.a < mockJson.a)) // Should be less than because cache has old value
  //    .then(() => jsonFetch(proxyServerUrl +'/'+ commandPrefix +'/overwrite?enabled=true'))
  //    .then(() => jsonFetch(proxyServerUrl + '/test'))
  //    .then(res => {
  //      assert(!res.headers.get(proxyHeaderIdentifier));  // Special Proxy cached header not sent
  //      return res.json();
  //    })
  //    .then((json) => {
  //      assert(proxy.isOverwriting());
  //      assert(json.a === mockJson.a); // Should be equal because it's using the updated mockJson
  //    })
  //    .then(() => {
  //      // File should exist
  //      return fs.stat(cacheDataDirectory + '/test/response.json', (err) => {
  //        assert(!err);
  //        done();
  //      });
  //    });
  //});

});