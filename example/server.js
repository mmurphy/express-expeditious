'use strict';

var expeditiousExpress = require('../lib/cache')
  , app = require('express')()
  , fs = require('fs');

var cacheMiddleware = expeditiousExpress({
  expeditious: require('expeditious')({
    // Use process memory as cache
    engine: require('expeditious-engine-memory')(),
    // Cache for 15 seconds
    defaultTtl: (15 * 1000),
    // Namespace for cache entries
    namespace: 'express'
  })
});


// Simulate slow loading content
function loadContent (err, callback) {
  setTimeout(function () {
    if (err) {
      callback(new Error('failed to get resource'));
    } else {
      fs.readFile(__dirname + '/index.html', 'utf8', callback);
    }
  }, 2000);
}

// This route does not use the cache middlware so it will always take
// 2 seconds or more to load
app.get('/not-cached', function (req, res) {
  loadContent(req.query.error, function (err, data) {
    if (err) {
      res.status(500).end('500 error!');
    } else {
      res.end(data);
    }
  });
});

// This route uses the cache middlware so it will take only 2 seconds to load
// for the first call. After the first call it will return cached data for the
// next 15 seconds (defaultTtl of expeditious instance above)
app.get('/cached', cacheMiddleware, function (req, res) {
  loadContent(req.query.error, function (err, data) {
    if (err) {
      res.status(500).end('500 error!');
    } else {
      res.end(data);
    }
  });
});

app.get('/cached/pipe', cacheMiddleware, function (req, res) {
  console.log('loading google via express');
  require('request').get('http://www.google.com').pipe(res);
});

app.listen(3000, function (err) {
  if (err) {
    throw err;
  }

  console.log('app listening on port 3000');
});
