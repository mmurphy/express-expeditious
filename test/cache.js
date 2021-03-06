'use strict';

var expeditious = require('expeditious')
  , supertest = require('supertest')
  , expect = require('chai').expect
  , sinon = require('sinon');

describe('cache middleware', function () {

  var mod = require('../lib/cache')
    , app
    , request
    , slowModuleStub
    , shouldCacheStub
    , engineStubs
    , PROCESSING_DELAY = 50;

  beforeEach(function () {
    app = require('express')();

    engineStubs = {
      set: sinon.stub(),
      get: sinon.stub(),
      del: sinon.stub(),
      keys: sinon.stub(),
      ttl: sinon.stub(),
      flush: sinon.stub(),
      getKeyWithoutNamespace: sinon.stub(),
      getNamespaceFromKey: sinon.stub()
    };

    shouldCacheStub = sinon.stub();

    // A fake module that we simulate slow responses from
    slowModuleStub = sinon.stub();

    // Create an instance
    mod = require('../lib/cache');

    // Add our cache to the express app
    app.use(
      mod({
        shouldCache: shouldCacheStub,
        expeditious: expeditious({
          engine: engineStubs,
          defaultTtl: 5000,
          namespace: 'expresstest'
        })
      })
    );

    // Convuluted function to simulate slow loading, chunked responses
    // We wrap with the first setTimeout to mimic a slow loading request/db
    // call. The second setTimeout mimics a stream that is taking a while to
    // write data which is necessary to test the ability of this module to
    // intelligently decide if it should buffer a response in memory to be
    // cached based on the fact it might already be buffering the same response
    function onReq (req, res) {
      setTimeout(function () {
        slowModuleStub(function (err) {
          if (err) {
            res.status(500).end('500 error');
          } else {
            res.write('o');

            // Simulate a slow stream
            setTimeout(function () {
              res.write('k');
              res.end();
            }, 5);
          }
        });
      }, PROCESSING_DELAY);
    }

    app.get('/', onReq);
    app.post('/', onReq);

    request = supertest(app);
  });

  it('should return data in the standard fashion', function (done) {
    engineStubs.get.yields(null, null);
    engineStubs.set.yields(null);
    slowModuleStub.yields(null);
    shouldCacheStub.returns(true);

    request
      .get('/')
      .expect(200)
      .end(function (err, res) {
        expect(engineStubs.get.calledOnce).to.be.true;
        expect(engineStubs.set.calledOnce).to.be.true;
        expect(shouldCacheStub.calledOnce).to.be.true;
        expect(slowModuleStub.calledOnce).to.be.true;

        expect(res.text).to.equal('ok');

        done();
      });
  });


  it('should use cache for the second call', function (done) {
    slowModuleStub.yields(null);
    shouldCacheStub.returns(true);
    engineStubs.set.yields(null);
    engineStubs.get.yields(null, null);

    function doRequest (callback) {
      request
        .get('/')
        .expect(200)
        .end(callback);
    }

    doRequest(function (err, firstRes) {
      expect(err).to.be.null;

      setTimeout(function () {

        // On the second call we want the cached data from the first call to
        // be returned to us
        engineStubs.get.yields(
          null,
          engineStubs.set.getCall(0).args[1]
        );

        doRequest(function (err, secondRes) {
          expect(err).to.be.null;
          expect(firstRes.text).to.equal(secondRes.text);

          expect(slowModuleStub.calledOnce).to.be.true;
          expect(engineStubs.get.callCount).to.equal(2);
          expect(engineStubs.set.calledOnce).to.be.true;
          expect(shouldCacheStub.callCount).to.equal(2);

          done();
        });
      }, 20);
    });
  });


  it('should not use the cache for any calls', function (done) {
    slowModuleStub.yields(null);
    shouldCacheStub.returns(false);

    function doRequest (callback) {
      request
        .get('/')
        .expect(200)
        .end(callback);
    }

    doRequest(function (err, firstRes) {
      expect(err).to.be.null;

      setTimeout(function () {
        doRequest(function (err, secondRes) {
          expect(err).to.be.null;
          expect(firstRes.text).to.equal(secondRes.text);

          expect(slowModuleStub.callCount).to.equal(2);
          expect(shouldCacheStub.callCount).to.equal(2);

          done();
        });
      }, 20);
    });
  });

  it('should use default route if cache.get fails', function (done) {
    slowModuleStub.yields(null);
    shouldCacheStub.returns(true);
    engineStubs.get.yields(new Error('failed to read cache'));

    request
      .get('/')
      .expect(200)
      .end(function (err, res) {
        expect(err).to.be.null;
        expect(slowModuleStub.calledOnce).to.be.true;
        expect(shouldCacheStub.calledOnce).to.be.true;
        expect(engineStubs.get.calledOnce).to.be.true;
        expect(engineStubs.set.calledOnce).to.be.true;
        expect(res.text).to.equal('ok');

        done();
      });
  });

  it('should process request on cache.set error', function (done) {
    slowModuleStub.yields(null);
    shouldCacheStub.returns(true);
    engineStubs.get.yields(null, null);
    engineStubs.set.yields(new Error('cache.set error'), null);

    request
      .get('/')
      .expect(200)
      .end(function (err, res) {
        expect(err).to.be.null;
        expect(slowModuleStub.calledOnce).to.be.true;
        expect(shouldCacheStub.calledOnce).to.be.true;
        expect(engineStubs.get.calledOnce).to.be.true;
        expect(engineStubs.set.calledOnce).to.be.true;
        expect(res.text).to.equal('ok');

        done();
      });
  });

  it('should only cache.set once on concurrent requests', function (done) {
    slowModuleStub.yields(null);
    shouldCacheStub.returns(true);
    engineStubs.get.yields(null, null);
    engineStubs.set.yields(null, null);

    function doRequest (callback) {
      request
        .get('/')
        .expect(200)
        .end(callback);
    }

    require('async').parallel([
      doRequest,
      doRequest
    ], function () {
      expect(slowModuleStub.callCount).to.equal(2);
      expect(shouldCacheStub.callCount).to.equal(2);
      expect(engineStubs.get.callCount).to.equal(2);
      expect(engineStubs.set.calledOnce).to.be.true;

      done();
    });
  });

});
