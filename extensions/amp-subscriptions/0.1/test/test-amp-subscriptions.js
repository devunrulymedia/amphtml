/**
 * Copyright 2018 The AMP HTML Authors. All Rights Reserved.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *      http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS-IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import {Entitlement} from '../entitlement';
import {LocalSubscriptionPlatform} from '../local-subscription-platform';
import {
  PageConfig,
  PageConfigResolver,
} from '../../../../third_party/subscriptions-project/config';
import {PlatformStore} from '../platform-store';
import {ServiceAdapter} from '../service-adapter';
import {SubscriptionAnalyticsEvents} from '../analytics';
import {SubscriptionPlatform} from '../subscription-platform';
import {SubscriptionService} from '../amp-subscriptions';
import {ViewerSubscriptionPlatform} from '../viewer-subscription-platform';
import {setTimeout} from 'timers';


describes.fakeWin('AmpSubscriptions', {amp: true}, env => {
  let win;
  let ampdoc;
  let element;
  let pageConfig;
  let subscriptionService;
  let configResolver;
  let analyticsEventStub;

  const products = ['scenic-2017.appspot.com:news',
    'scenic-2017.appspot.com:product2'];

  const serviceConfig = {
    services: [
      {
        authorizationUrl: 'https://lipsum.com/authorize',
        actions: {
          subscribe: 'https://lipsum.com/subscribe',
          login: 'https://lipsum.com/login',
        },
      },
      {
        serviceId: 'google.subscription',
      },
    ],
  };

  beforeEach(() => {
    win = env.win;
    ampdoc = env.ampdoc;
    element = win.document.createElement('script');
    element.id = 'amp-subscriptions';
    element.setAttribute('type', 'json');
    element.innerHTML = JSON.stringify(serviceConfig);

    win.document.body.appendChild(element);
    subscriptionService = new SubscriptionService(ampdoc);
    pageConfig = new PageConfig('scenic-2017.appspot.com:news', true);
    sandbox.stub(PageConfigResolver.prototype, 'resolveConfig')
        .callsFake(function() {
          configResolver = this;
          return Promise.resolve(pageConfig);
        });
    sandbox.stub(subscriptionService, 'getPlatformConfig_')
        .callsFake(() => Promise.resolve(serviceConfig));
    analyticsEventStub = sandbox.stub(
        subscriptionService.subscriptionAnalytics_,
        'event'
    );
  });

  it('should call `initialize_` on start', () => {
    const localPlatformStub =
      sandbox.stub(subscriptionService, 'initializeLocalPlatforms_');
    const initializeStub = sandbox.spy(subscriptionService, 'initialize_');
    subscriptionService.start();
    expect(initializeStub).to.be.calledOnce;
    return subscriptionService.initialize_().then(() => {
      expect(analyticsEventStub).to.be.calledWith(
          SubscriptionAnalyticsEvents.STARTED);
      expect(localPlatformStub).to.be.called;
    });
  });

  it('should setup store and page on start', () => {
    sandbox.stub(subscriptionService, 'initializeLocalPlatforms_');
    const renderLoadingStub =
        sandbox.spy(subscriptionService.renderer_, 'toggleLoading');

    subscriptionService.start();
    return subscriptionService.initialize_().then(() => {
      // Should show loading on the page
      expect(renderLoadingStub).to.be.calledWith(true);
      // Should setup platform store
      expect(subscriptionService.platformStore_).to.be
          .instanceOf(PlatformStore);
    });
  });

  it('should discover page configuration', () => {
    return subscriptionService.initialize_().then(() => {
      expect(subscriptionService.pageConfig_).to.equal(pageConfig);
    });
  });

  it('should search ampdoc-scoped config', () => {
    return subscriptionService.initialize_().then(() => {
      expect(configResolver.doc_.ampdoc_).to.equal(ampdoc);
    });
  });

  it('should start auth flow for short circuiting', () => {
    const authFlowStub = sandbox.stub(subscriptionService,
        'startAuthorizationFlow_');
    const delegateStub = sandbox.stub(subscriptionService,
        'delegateAuthToViewer_');
    sandbox.stub(subscriptionService, 'initialize_')
        .callsFake(() => Promise.resolve());
    subscriptionService.pageConfig_ = pageConfig;
    subscriptionService.doesViewerProvideAuth_ = true;
    subscriptionService.start();
    return subscriptionService.initialize_().then(() => {
      expect(authFlowStub.withArgs(false)).to.be.calledOnce;
      expect(delegateStub).to.be.calledOnce;
    });
  });

  it('should add subscription platform while registering it', () => {
    const serviceData = serviceConfig['services'][1];
    const platform = new SubscriptionPlatform();
    const entitlementData = {source: 'local',
      service: 'local', products, subscriptionToken: 'token'};
    const entitlement = Entitlement.parseFromJson(entitlementData);
    const factoryStub = sandbox.stub().callsFake(() => platform);

    subscriptionService.platformStore_ = new PlatformStore(
        [serviceData.serviceId]);

    platform.getEntitlements = sandbox.stub()
        .callsFake(() => Promise.resolve(entitlement));
    platform.getServiceId = sandbox.stub().callsFake(() => 'local');

    subscriptionService.platformConfig_ = serviceConfig;
    subscriptionService.registerPlatform(serviceData.serviceId, factoryStub);

    return subscriptionService.initialize_().then(() => {
      expect(factoryStub).to.be.calledOnce;
      expect(factoryStub.getCall(0).args[0]).to.be.equal(serviceData);
      expect(factoryStub.getCall(0).args[1]).to.be.equal(
          subscriptionService.serviceAdapter_);
      expect(analyticsEventStub).to.be.calledWith(
          SubscriptionAnalyticsEvents.PLATFORM_REGISTERED,
          {
            serviceId: 'local',
          }
      );
    });
  });

  describe('getPlatformConfig_', () => {
    it('should return json inside script#amp-subscriptions tag ', done => {
      subscriptionService.getPlatformConfig_.restore();
      subscriptionService.getPlatformConfig_().then(config => {
        expect(JSON.stringify(config)).to.be.equal(
            JSON.stringify(serviceConfig));
        done();
      });
    });
  });

  describe('initializeLocalPlatforms_', () => {
    it('should put `LocalSubscriptionPlatform` for every service config'
        + ' with authorization Url', () => {
      const service = serviceConfig.services[0];
      subscriptionService.serviceAdapter_ =
        new ServiceAdapter(subscriptionService);
      subscriptionService.pageConfig_ = pageConfig;
      subscriptionService.platformStore_ = new PlatformStore('local');
      subscriptionService.initializeLocalPlatforms_(service);
      expect(subscriptionService.platformStore_.subscriptionPlatforms_['local'])
          .to.be.not.null;
      expect(subscriptionService.platformStore_.subscriptionPlatforms_['local'])
          .to.be.instanceOf(LocalSubscriptionPlatform);
    });
  });

  describe('selectAndActivatePlatform_', () => {
    it('should wait for grantStatus and selectPlatform promise', () => {
      sandbox.stub(subscriptionService, 'fetchEntitlements_');
      subscriptionService.start();
      subscriptionService.viewTrackerPromise_ = Promise.resolve();
      return subscriptionService.initialize_().then(() => {
        resolveRequiredPromises(subscriptionService);
        const localPlatform =
            subscriptionService.platformStore_.getLocalPlatform();
        const selectPlatformStub =
            subscriptionService.platformStore_.selectPlatform;
        const activateStub = sandbox.stub(localPlatform, 'activate');
        expect(localPlatform).to.be.not.null;
        return subscriptionService.selectAndActivatePlatform_().then(() => {
          expect(activateStub).to.be.calledOnce;
          expect(selectPlatformStub).to.be.calledWith(true);
          expect(analyticsEventStub).to.be.calledWith(
              SubscriptionAnalyticsEvents.PLATFORM_ACTIVATED,
              {
                'serviceId': 'local',
              }
          );
        });
      });
    });
    it('should call selectPlatform with preferViewerSupport config', () => {
      sandbox.stub(subscriptionService, 'fetchEntitlements_');
      subscriptionService.start();
      subscriptionService.viewTrackerPromise_ = Promise.resolve();
      return subscriptionService.initialize_().then(() => {
        resolveRequiredPromises(subscriptionService);
        const selectPlatformStub =
          subscriptionService.platformStore_.selectPlatform;
        subscriptionService.platformConfig_['preferViewerSupport'] = false;
        return subscriptionService.selectAndActivatePlatform_().then(() => {
          expect(selectPlatformStub).to.be.calledWith(false);
        });
      });
    });
    function resolveRequiredPromises(subscriptionService) {
      const entitlement = new Entitlement({source: 'local', raw: 'raw',
        service: 'local', products, subscriptionToken: 'token'});
      entitlement.setCurrentProduct('product1');
      const localPlatform =
        subscriptionService.platformStore_.getLocalPlatform();
      sandbox.stub(subscriptionService.platformStore_, 'getGrantStatus')
          .callsFake(() => Promise.resolve());
      subscriptionService.platformStore_.resolveEntitlement('local',
          entitlement);
      sandbox.stub(
          subscriptionService.platformStore_,
          'selectPlatform'
      ).callsFake(() => Promise.resolve(localPlatform));
    }
  });

  describe('startAuthorizationFlow_', () => {
    it('should start grantStatus and platform selection', () => {
      subscriptionService.platformStore_ = new PlatformStore(products);
      const getGrantStatusStub =
          sandbox.stub(subscriptionService.platformStore_, 'getGrantStatus')
              .callsFake(() => Promise.resolve());
      const selectAndActivateStub =
          sandbox.stub(subscriptionService, 'selectAndActivatePlatform_');
      subscriptionService.startAuthorizationFlow_();
      expect(getGrantStatusStub).to.be.calledOnce;
      expect(selectAndActivateStub).to.be.calledOnce;
    });

    it('should not call selectAndActivatePlatform based on param', () => {
      subscriptionService.platformStore_ = new PlatformStore(products);
      const getGrantStatusStub =
          sandbox.stub(subscriptionService.platformStore_, 'getGrantStatus')
              .callsFake(() => Promise.resolve());
      const selectAndActivateStub =
          sandbox.stub(subscriptionService, 'selectAndActivatePlatform_');
      subscriptionService.startAuthorizationFlow_(false);
      expect(getGrantStatusStub).to.be.calledOnce;
      expect(selectAndActivateStub).to.not.be.called;
    });
  });

  describe('fetchEntitlements_', () => {
    let platform;
    let serviceAdapter;
    let firstVisibleStub;
    beforeEach(() => {
      serviceAdapter = new ServiceAdapter(subscriptionService);
      firstVisibleStub = sandbox.stub(subscriptionService.viewer_,
          'whenFirstVisible').callsFake(() => Promise.resolve());
      subscriptionService.pageConfig_ = pageConfig;
      platform = new LocalSubscriptionPlatform(ampdoc,
          serviceConfig.services[0],
          serviceAdapter);
      subscriptionService.platformStore_ = new PlatformStore(['local']);
    });
    afterEach(() => {
      expect(firstVisibleStub).to.be.called;
    });
    it('should report failure if platform timeouts', done => {
      sandbox.stub(platform, 'getEntitlements')
          .callsFake(() => new Promise(resolve => setTimeout(resolve, 8000)));
      const failureStub = sandbox.stub(subscriptionService.platformStore_,
          'reportPlatformFailure');
      subscriptionService.fetchEntitlements_(platform)
          .catch(() => {
            expect(failureStub).to.be.calledOnce;
            done();
          });
    }).timeout(7000);

    it('should report failure if platform reject promise', done => {
      sandbox.stub(platform, 'getEntitlements')
          .callsFake(() => Promise.reject());
      const failureStub = sandbox.stub(subscriptionService.platformStore_,
          'reportPlatformFailure');
      const promise = subscriptionService.fetchEntitlements_(platform)
          .catch(() => {
            expect(failureStub).to.be.calledOnce;
            done();
          });
      expect(promise).to.throw;
    });

    it('should resolve entitlement if platform resolves', () => {
      const entitlement = new Entitlement({source: 'local', raw: 'raw',
        service: 'local', products, subscriptionToken: 'token'});
      sandbox.stub(platform, 'getEntitlements')
          .callsFake(() => Promise.resolve(entitlement));
      const resolveStub = sandbox.stub(subscriptionService.platformStore_,
          'resolveEntitlement');
      return subscriptionService.fetchEntitlements_(platform).then(() => {
        expect(resolveStub).to.be.calledOnce;
        expect(resolveStub.getCall(0).args[1]).to.deep.equal(entitlement);
        expect(analyticsEventStub).to.be.calledWith(
            SubscriptionAnalyticsEvents.ENTITLEMENT_RESOLVED,
            {
              'serviceId': 'local',
            }
        );
      });
    });
  });

  describe('viewer authorization', () => {
    let fetchEntitlementsStub;
    beforeEach(() => {
      subscriptionService.pageConfig_ = pageConfig;
      subscriptionService.platformConfig_ = serviceConfig;
      subscriptionService.doesViewerProvideAuth_ = true;
      sandbox.stub(subscriptionService, 'initialize_')
          .callsFake(() => Promise.resolve());
      sandbox.stub(subscriptionService.viewer_, 'sendMessageAwaitResponse')
          .callsFake(() => Promise.resolve());
      fetchEntitlementsStub = sandbox.stub(subscriptionService,
          'fetchEntitlements_');
    });
    it('should put LocalSubscriptionPlatform in platformstore, '
        + 'if viewer does not have auth capability', () => {
      subscriptionService.doesViewerProvideAuth_ = false;
      subscriptionService.start();
      return subscriptionService.initialize_().then(() => {
        expect(subscriptionService.platformStore_.getLocalPlatform()).to.be
            .instanceOf(LocalSubscriptionPlatform);
      });
    });

    it('should put ViewerSubscriptionPlatform in platformstore, '
        + 'if viewer does have auth capability', () => {
      subscriptionService.start();
      return subscriptionService.initialize_().then(() => {
        expect(subscriptionService.platformStore_.getLocalPlatform()).to.be
            .instanceOf(ViewerSubscriptionPlatform);
      });
    });

    it('should not fetch entitlements for any platform other than '
        + 'local', () => {
      subscriptionService.start();
      return subscriptionService.initialize_().then(() => {
        subscriptionService.registerPlatform('google.subscription',
            new SubscriptionPlatform());
        expect(fetchEntitlementsStub).to.not.be.called;
      });
    });

    it('should fetch entitlements for other platforms if viewer does '
        + 'not provide auth', () => {
      subscriptionService.doesViewerProvideAuth_ = false;
      subscriptionService.start();
      subscriptionService.registerPlatform('google.subscription',
          () => new SubscriptionPlatform());
      return subscriptionService.initialize_().then(() => {
        expect(fetchEntitlementsStub).to.be.called;
      });
    });
  });
});
