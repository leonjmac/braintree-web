"use strict";

jest.mock("../../../src/lib/analytics");
jest.mock("../../../src/venmo/shared/supports-venmo");
jest.mock("../../../src/venmo/external");
jest.mock("../../../src/lib/in-iframe");

const analytics = require("../../../src/lib/analytics");
const { fake } = require("../../helpers");
const querystring = require("../../../src/lib/querystring");
const BraintreeError = require("../../../src/lib/braintree-error");
const Venmo = require("../../../src/venmo/venmo");
const browserDetection = require("../../../src/venmo/shared/browser-detection");
const supportsVenmo = require("../../../src/venmo/shared/supports-venmo");
const inIframe = require("../../../src/lib/in-iframe");
const { version: VERSION } = require("../../../package.json");
const methods = require("../../../src/lib/methods");
const createVenmoDesktop = require("../../../src/venmo/external");

function triggerVisibilityHandler(instance, runAllTimers = true) {
  // TODO we should have it trigger the actual
  // visibility event if possible, rather than
  // calling the method saved on the instance
  instance._visibilityChangeListener();

  if (runAllTimers) {
    jest.runAllTimers();
  }
}

function triggerHashChangeHandler(instance) {
  instance._onHashChangeListener({
    newURL: window.location.href,
  });

  jest.runAllTimers();
}

async function flushPromises() {
  await Promise.resolve();
  await Promise.resolve().then(() => jest.advanceTimersByTime(1));
  await Promise.resolve();
}

describe("Venmo", () => {
  let testContext, originalLocationHref;

  beforeAll(() => {
    window.open = jest.fn();
    originalLocationHref = window.location.href;
  });

  beforeEach(() => {
    jest.useFakeTimers();

    testContext = {};
    inIframe.mockReturnValue(false);

    testContext.location = originalLocationHref;
    testContext.configuration = fake.configuration();
    testContext.client = {
      request: jest.fn().mockResolvedValue({}),
      getConfiguration: () => testContext.configuration,
    };

    jest.spyOn(document, "addEventListener");
    jest.spyOn(document, "removeEventListener");
  });

  afterEach(() => {
    window.location.href = originalLocationHref;
    jest.clearAllTimers();
    jest.useRealTimers();
  });

  it("sends analytics events when venmo is not configured for desktop", async () => {
    new Venmo({
      createPromise: Promise.resolve(testContext.client),
    });

    await flushPromises();

    expect(analytics.sendEvent).not.toBeCalledWith(
      expect.anything(),
      "venmo.desktop-flow.configured.true"
    );
    expect(analytics.sendEvent).toBeCalledWith(
      expect.anything(),
      "venmo.desktop-flow.configured.false"
    );
    expect(analytics.sendEvent).not.toBeCalledWith(
      expect.anything(),
      "venmo.desktop-flow.presented"
    );
  });

  it("sends analytics events for configuring venmo for desktop", async () => {
    // pass a stub so create methods don't hang
    createVenmoDesktop.mockResolvedValue({});
    new Venmo({
      allowDesktop: true,
      createPromise: Promise.resolve(testContext.client),
    });

    await flushPromises();

    expect(analytics.sendEvent).not.toBeCalledWith(
      expect.anything(),
      "venmo.desktop-flow.configured.false"
    );
    expect(analytics.sendEvent).toBeCalledWith(
      expect.anything(),
      "venmo.desktop-flow.configured.true"
    );
    expect(analytics.sendEvent).toBeCalledWith(
      expect.anything(),
      "venmo.desktop-flow.presented"
    );
  });

  it("sends analytics events for when venmo desktop setup fails", async () => {
    // pass a stub so create methods don't hang
    createVenmoDesktop.mockRejectedValue(new Error("foo"));
    new Venmo({
      allowDesktop: true,
      createPromise: Promise.resolve(testContext.client),
    });

    await flushPromises();

    expect(analytics.sendEvent).not.toBeCalledWith(
      expect.anything(),
      "venmo.desktop-flow.presented"
    );
    expect(analytics.sendEvent).toBeCalledWith(
      expect.anything(),
      "venmo.desktop-flow.setup-failed"
    );
  });

  it("configures venmo desktop with payment method usage (if passed)", async () => {
    createVenmoDesktop.mockResolvedValue({});
    new Venmo({
      allowDesktop: true,
      createPromise: Promise.resolve(testContext.client),
      paymentMethodUsage: "multi_use",
    });

    await flushPromises();

    expect(createVenmoDesktop).toBeCalledWith(
      expect.objectContaining({
        paymentMethodUsage: "MULTI_USE",
      })
    );
  });

  it("configures venmo desktop with display name (if passed)", async () => {
    createVenmoDesktop.mockResolvedValue({});
    new Venmo({
      allowDesktop: true,
      createPromise: Promise.resolve(testContext.client),
      displayName: "name",
    });

    await flushPromises();

    expect(createVenmoDesktop).toBeCalledWith(
      expect.objectContaining({
        displayName: "name",
      })
    );
  });

  it("configures venmo desktop with default merchant id", async () => {
    createVenmoDesktop.mockResolvedValue({});
    new Venmo({
      allowDesktop: true,
      createPromise: Promise.resolve(testContext.client),
    });

    await flushPromises();

    expect(createVenmoDesktop).toBeCalledWith(
      expect.objectContaining({
        profileId: "pwv-merchant-id",
      })
    );
  });

  it("can configure venmo desktop with a specific profile id", async () => {
    createVenmoDesktop.mockResolvedValue({});
    new Venmo({
      allowDesktop: true,
      profileId: "profile-id",
      createPromise: Promise.resolve(testContext.client),
    });

    await flushPromises();

    expect(createVenmoDesktop).toBeCalledWith(
      expect.objectContaining({
        profileId: "profile-id",
      })
    );
  });

  it("sets up a payment context using legacy mutation when mobile polling flow is used without paymentMethodUsage when in an iframe", async () => {
    testContext.client.request.mockResolvedValue({
      data: {
        createVenmoQRCodePaymentContext: {
          venmoQRCodePaymentContext: {
            status: "CREATED",
            id: "context-id",
            createdAt: "2021-01-20T03:25:37.522000Z",
            expiresAt: "2021-01-20T03:30:37.522000Z",
          },
        },
      },
    });
    inIframe.mockReturnValue(true);
    const venmo = new Venmo({
      createPromise: Promise.resolve(testContext.client),
    });

    await flushPromises();

    expect(testContext.client.request).toBeCalledWith({
      api: "graphQLApi",
      data: {
        query: expect.stringMatching(
          "mutation CreateVenmoQRCodePaymentContext"
        ),
        variables: {
          input: {
            environment: "SANDBOX",
            intent: "PAY_FROM_APP",
          },
        },
      },
    });
    expect(analytics.sendEvent).toBeCalledWith(
      expect.anything(),
      "venmo.manual-return.presented"
    );

    expect(venmo._venmoPaymentContextStatus).toBe("CREATED");
    expect(venmo._venmoPaymentContextId).toBe("context-id");
  });

  it("sets up a payment context when mobile polling flow is used with paymentMethodUsage when in an iframe", async () => {
    testContext.client.request.mockResolvedValue({
      data: {
        createVenmoPaymentContext: {
          venmoPaymentContext: {
            status: "CREATED",
            id: "context-id",
            createdAt: "2021-01-20T03:25:37.522000Z",
            expiresAt: "2021-01-20T03:30:37.522000Z",
          },
        },
      },
    });
    inIframe.mockReturnValue(true);
    const venmo = new Venmo({
      createPromise: Promise.resolve(testContext.client),
      paymentMethodUsage: "single_use",
    });

    await flushPromises();

    expect(testContext.client.request).toBeCalledWith({
      api: "graphQLApi",
      data: {
        query: expect.stringMatching("mutation CreateVenmoPaymentContext"),
        variables: {
          input: {
            paymentMethodUsage: "SINGLE_USE",
            intent: "CONTINUE",
            customerClient: "MOBILE_WEB",
          },
        },
      },
    });
    expect(analytics.sendEvent).toBeCalledWith(
      expect.anything(),
      "venmo.manual-return.presented"
    );

    expect(venmo._venmoPaymentContextStatus).toBe("CREATED");
    expect(venmo._venmoPaymentContextId).toBe("context-id");
  });

  it("sets up a payment context using legacy mutation when mobile polling flow is used without paymentMethodUsage when configured from manual return", async () => {
    testContext.client.request.mockResolvedValue({
      data: {
        createVenmoQRCodePaymentContext: {
          venmoQRCodePaymentContext: {
            status: "CREATED",
            id: "context-id",
            createdAt: "2021-01-20T03:25:37.522000Z",
            expiresAt: "2021-01-20T03:30:37.522000Z",
          },
        },
      },
    });

    const venmo = new Venmo({
      createPromise: Promise.resolve(testContext.client),
      requireManualReturn: true,
    });

    await flushPromises();

    expect(testContext.client.request).toBeCalledWith({
      api: "graphQLApi",
      data: {
        query: expect.stringMatching(
          "mutation CreateVenmoQRCodePaymentContext"
        ),
        variables: {
          input: {
            environment: "SANDBOX",
            intent: "PAY_FROM_APP",
          },
        },
      },
    });
    expect(analytics.sendEvent).toBeCalledWith(
      expect.anything(),
      "venmo.manual-return.presented"
    );

    expect(venmo._venmoPaymentContextStatus).toBe("CREATED");
    expect(venmo._venmoPaymentContextId).toBe("context-id");
  });

  it("sets up a payment context when mobile polling flow is used with paymentMethodUsage when configured from manual return", async () => {
    testContext.client.request.mockResolvedValue({
      data: {
        createVenmoPaymentContext: {
          venmoPaymentContext: {
            status: "CREATED",
            id: "context-id",
            createdAt: "2021-01-20T03:25:37.522000Z",
            expiresAt: "2021-01-20T03:30:37.522000Z",
          },
        },
      },
    });
    const venmo = new Venmo({
      createPromise: Promise.resolve(testContext.client),
      requireManualReturn: true,
      paymentMethodUsage: "single_use",
    });

    await flushPromises();

    expect(testContext.client.request).toBeCalledWith({
      api: "graphQLApi",
      data: {
        query: expect.stringMatching("mutation CreateVenmoPaymentContext"),
        variables: {
          input: {
            paymentMethodUsage: "SINGLE_USE",
            intent: "CONTINUE",
            customerClient: "MOBILE_WEB",
          },
        },
      },
    });
    expect(analytics.sendEvent).toBeCalledWith(
      expect.anything(),
      "venmo.manual-return.presented"
    );

    expect(venmo._venmoPaymentContextStatus).toBe("CREATED");
    expect(venmo._venmoPaymentContextId).toBe("context-id");
  });

  it("sets up a payment context when hash change flow is used with paymentMethodUsage", async () => {
    testContext.client.request.mockResolvedValue({
      data: {
        createVenmoPaymentContext: {
          venmoPaymentContext: {
            status: "CREATED",
            id: "context-id",
            createdAt: "2021-01-20T03:25:37.522000Z",
            expiresAt: "2021-01-20T03:30:37.522000Z",
          },
        },
      },
    });
    const venmo = new Venmo({
      createPromise: Promise.resolve(testContext.client),
      paymentMethodUsage: "single_use",
    });

    await flushPromises();

    expect(testContext.client.request).toBeCalledWith({
      api: "graphQLApi",
      data: {
        query: expect.stringMatching("mutation CreateVenmoPaymentContext"),
        variables: {
          input: {
            paymentMethodUsage: "SINGLE_USE",
            intent: "CONTINUE",
            customerClient: "MOBILE_WEB",
          },
        },
      },
    });
    expect(analytics.sendEvent).toBeCalledWith(
      expect.anything(),
      "venmo.mobile-payment-context.presented"
    );

    expect(venmo._venmoPaymentContextStatus).toBe("CREATED");
    expect(venmo._venmoPaymentContextId).toBe("context-id");
  });

  it("sets up a payment context with display name when configured with paymentMethodUsage", async () => {
    testContext.client.request.mockResolvedValue({
      data: {
        createVenmoPaymentContext: {
          venmoPaymentContext: {
            status: "CREATED",
            id: "context-id",
            createdAt: "2021-01-20T03:25:37.522000Z",
            expiresAt: "2021-01-20T03:30:37.522000Z",
          },
        },
      },
    });
    // eslint-disable-next-line no-unused-vars
    const venmo = new Venmo({
      createPromise: Promise.resolve(testContext.client),
      paymentMethodUsage: "single_use",
      displayName: "name",
    });

    await flushPromises();

    expect(testContext.client.request).toBeCalledWith({
      api: "graphQLApi",
      data: {
        query: expect.stringMatching("mutation CreateVenmoPaymentContext"),
        variables: {
          input: {
            paymentMethodUsage: "SINGLE_USE",
            displayName: "name",
            intent: "CONTINUE",
            customerClient: "MOBILE_WEB",
          },
        },
      },
    });
  });

  it("ignores display name when not configured with paymentMethodUsage", async () => {
    testContext.client.request.mockResolvedValue({
      data: {
        createVenmoQRCodePaymentContext: {
          venmoQRCodePaymentContext: {
            status: "CREATED",
            id: "context-id",
            createdAt: "2021-01-20T03:25:37.522000Z",
            expiresAt: "2021-01-20T03:30:37.522000Z",
          },
        },
      },
    });
    // eslint-disable-next-line no-unused-vars
    const venmo = new Venmo({
      createPromise: Promise.resolve(testContext.client),
      requireManualReturn: true,
      displayName: "name",
    });

    await flushPromises();

    expect(testContext.client.request).toBeCalledWith({
      api: "graphQLApi",
      data: {
        query: expect.stringMatching(
          "mutation CreateVenmoQRCodePaymentContext"
        ),
        variables: {
          input: {
            environment: "SANDBOX",
            intent: "PAY_FROM_APP",
          },
        },
      },
    });
  });

  it("does not create a new payment context or venmo desktop when url hash has tokenization results", async () => {
    jest.spyOn(Venmo.prototype, "hasTokenizationResult").mockReturnValue(true);

    // eslint-disable-next-line no-unused-vars
    const venmo = new Venmo({
      createPromise: Promise.resolve(testContext.client),
      paymentMethodUsage: "single_use",
    });

    await flushPromises();

    expect(testContext.client.request).not.toBeCalled();
    expect(createVenmoDesktop).not.toBeCalled();

    expect(analytics.sendEvent).toBeCalledWith(
      expect.anything(),
      "venmo.appswitch.return-in-new-tab"
    );
  });

  it("refreshes the payment context after 2/3 of the expiration time has passed", async () => {
    testContext.client.request.mockResolvedValueOnce({
      data: {
        createVenmoQRCodePaymentContext: {
          venmoQRCodePaymentContext: {
            status: "CREATED",
            id: "first-context-id",
            createdAt: "2021-01-20T03:25:00.000000Z",
            expiresAt: "2021-01-20T03:25:10.000000Z",
          },
        },
      },
    });
    testContext.client.request.mockResolvedValueOnce({
      data: {
        createVenmoQRCodePaymentContext: {
          venmoQRCodePaymentContext: {
            status: "CREATED",
            id: "second-context-id",
            createdAt: "2021-01-20T03:25:00.000000Z",
            expiresAt: "2021-01-20T03:25:10.000000Z",
          },
        },
      },
    });
    inIframe.mockReturnValue(true);
    const venmo = new Venmo({
      createPromise: Promise.resolve(testContext.client),
    });

    await flushPromises();

    expect(venmo._venmoPaymentContextId).toBe("first-context-id");

    jest.advanceTimersByTime(6000); // 6 seconds

    await flushPromises();

    expect(venmo._venmoPaymentContextId).toBe("first-context-id");

    jest.advanceTimersByTime(1000); // 1 second

    await flushPromises();

    expect(venmo._venmoPaymentContextId).toBe("second-context-id");
  });

  it("does not refresh the payment context after 2/3 of the expiration time has passed when tokenization is in progress", async () => {
    testContext.client.request.mockResolvedValueOnce({
      data: {
        createVenmoQRCodePaymentContext: {
          venmoQRCodePaymentContext: {
            status: "CREATED",
            id: "first-context-id",
            createdAt: "2021-01-20T03:25:00.000000Z",
            expiresAt: "2021-01-20T03:25:10.000000Z",
          },
        },
      },
    });
    testContext.client.request.mockResolvedValueOnce({
      data: {
        createVenmoQRCodePaymentContext: {
          venmoQRCodePaymentContext: {
            status: "CREATED",
            id: "second-context-id",
            createdAt: "2021-01-20T03:25:00.000000Z",
            expiresAt: "2021-01-20T03:25:10.000000Z",
          },
        },
      },
    });
    inIframe.mockReturnValue(true);
    const venmo = new Venmo({
      createPromise: Promise.resolve(testContext.client),
    });

    await flushPromises();

    expect(venmo._venmoPaymentContextId).toBe("first-context-id");

    jest.advanceTimersByTime(6000); // 6 seconds

    venmo._tokenizationInProgress = true;

    await flushPromises();

    expect(venmo._venmoPaymentContextId).toBe("first-context-id");

    jest.advanceTimersByTime(5000); // 5 seconds

    await flushPromises();

    expect(venmo._venmoPaymentContextId).toBe("first-context-id");
    expect(testContext.client.request).toBeCalledTimes(1);
    expect(testContext.client.request).toHaveBeenNthCalledWith(1, {
      api: "graphQLApi",
      data: expect.objectContaining({
        query: expect.stringMatching(
          "mutation CreateVenmoQRCodePaymentContext"
        ),
      }),
    });
  });

  it("does make a request for a new payment context after 2/3 of the expiration time has passed, but does not update the reference to the payment context if tokenization started while the request for the new payment context was in process", async () => {
    testContext.client.request.mockResolvedValueOnce({
      data: {
        createVenmoQRCodePaymentContext: {
          venmoQRCodePaymentContext: {
            status: "CREATED",
            id: "first-context-id",
            createdAt: "2021-01-20T03:25:00.000000Z",
            expiresAt: "2021-01-20T03:25:10.000000Z",
          },
        },
      },
    });
    testContext.client.request.mockResolvedValueOnce({
      data: {
        createVenmoQRCodePaymentContext: {
          venmoQRCodePaymentContext: {
            status: "CREATED",
            id: "second-context-id",
            createdAt: "2021-01-20T03:25:00.000000Z",
            expiresAt: "2021-01-20T03:25:10.000000Z",
          },
        },
      },
    });
    inIframe.mockReturnValue(true);
    const venmo = new Venmo({
      createPromise: Promise.resolve(testContext.client),
    });

    await flushPromises();

    expect(venmo._venmoPaymentContextId).toBe("first-context-id");

    jest.advanceTimersByTime(6667); // just over the 2/3 threshold

    venmo._tokenizationInProgress = true;

    await flushPromises();

    expect(venmo._venmoPaymentContextId).toBe("first-context-id");

    jest.advanceTimersByTime(1000); // 1 second

    await flushPromises();

    expect(venmo._venmoPaymentContextId).toBe("first-context-id");
    expect(testContext.client.request).toBeCalledTimes(2);
    expect(testContext.client.request).toHaveBeenNthCalledWith(1, {
      api: "graphQLApi",
      data: expect.objectContaining({
        query: expect.stringMatching(
          "mutation CreateVenmoQRCodePaymentContext"
        ),
      }),
    });
    expect(testContext.client.request).toHaveBeenNthCalledWith(2, {
      api: "graphQLApi",
      data: expect.objectContaining({
        query: expect.stringMatching(
          "mutation CreateVenmoQRCodePaymentContext"
        ),
      }),
    });
  });

  it("errors when payment context fails to set up in mobile polling flow", async () => {
    expect.assertions(4);

    const networkError = new Error("some network error");

    testContext.client.request.mockRejectedValue(networkError);
    inIframe.mockResolvedValue(true);
    const venmo = new Venmo({
      createPromise: Promise.resolve(testContext.client),
    });

    await venmo.getUrl().catch((err) => {
      expect(err.code).toBe("VENMO_MOBILE_PAYMENT_CONTEXT_SETUP_FAILED");
      expect(err.details.originalError).toBe(networkError);

      expect(analytics.sendEvent).not.toBeCalledWith(
        expect.anything(),
        "venmo.manual-return.presented"
      );
      expect(analytics.sendEvent).toBeCalledWith(
        expect.anything(),
        "venmo.manual-return.setup-failed"
      );
    });
  });

  it("errors when payment context fails to set up in payment method usage hash flow", async () => {
    expect.assertions(4);

    const networkError = new Error("some network error");

    testContext.client.request.mockRejectedValue(networkError);
    const venmo = new Venmo({
      createPromise: Promise.resolve(testContext.client),
      paymentMethodUsage: "single_use",
    });

    await venmo.getUrl().catch((err) => {
      expect(err.code).toBe("VENMO_MOBILE_PAYMENT_CONTEXT_SETUP_FAILED");
      expect(err.details.originalError).toBe(networkError);

      expect(analytics.sendEvent).not.toBeCalledWith(
        expect.anything(),
        "venmo.mobile-payment-context.presented"
      );
      expect(analytics.sendEvent).toBeCalledWith(
        expect.anything(),
        "venmo.mobile-payment-context.setup-failed"
      );
    });
  });

  describe("getUrl", () => {
    let venmo;

    beforeEach(() => {
      venmo = new Venmo({ createPromise: Promise.resolve(testContext.client) });
    });

    afterEach(() => {
      history.replaceState({}, "", testContext.location);
    });

    it("is set to correct base URL", () =>
      venmo.getUrl().then((url) => {
        expect(url.indexOf("https://venmo.com/braintree/checkout")).toBe(0);
      }));

    it("removes hash from parent page url for use with return urls", () => {
      const pageUrlWithoutHash = window.location.href;

      window.location.hash = "#bar";

      return venmo.getUrl().then((url) => {
        const params = querystring.parse(url);

        expect(params["x-success"]).toBe(
          `${pageUrlWithoutHash}#venmoSuccess=1`
        );
        expect(params["x-cancel"]).toBe(`${pageUrlWithoutHash}#venmoCancel=1`);
        expect(params["x-error"]).toBe(`${pageUrlWithoutHash}#venmoError=1`);
      });
    });

    it("removes hash with no value from parent page url", () => {
      const pageUrlWithoutHash = window.location.href;

      window.location.hash = "#";

      return venmo.getUrl().then((url) => {
        const params = querystring.parse(url);

        expect(params["x-success"]).toBe(
          `${pageUrlWithoutHash}#venmoSuccess=1`
        );
        expect(params["x-cancel"]).toBe(`${pageUrlWithoutHash}#venmoCancel=1`);
        expect(params["x-error"]).toBe(`${pageUrlWithoutHash}#venmoError=1`);
      });
    });

    it.each([
      ["", window.location.href, false],
      [
        "when deepLinkReturnUrl is specified",
        "com.braintreepayments.test://",
        true,
      ],
      [
        "when checkout page URL has query params",
        `${window.location.href}?hey=now`,
        false,
      ],
    ])("contains return URL %s", (s, location, deepLinked) => {
      let params;
      const expectedReturnUrls = {
        "x-success": `${location}#venmoSuccess=1`,
        "x-cancel": `${location}#venmoCancel=1`,
        "x-error": `${location}#venmoError=1`,
      };

      if (deepLinked) {
        venmo = new Venmo({
          createPromise: Promise.resolve(testContext.client),
          deepLinkReturnUrl: location,
        });
      } else if (location !== testContext.location) {
        history.replaceState({}, "", location);
      }

      return venmo.getUrl().then((url) => {
        params = querystring.parse(url);
        expect(params["x-success"]).toBe(expectedReturnUrls["x-success"]);
        expect(params["x-cancel"]).toBe(expectedReturnUrls["x-cancel"]);
        expect(params["x-error"]).toBe(expectedReturnUrls["x-error"]);
      });
    });

    it("omits return urls when using polling flow without a deep link return url", () => {
      testContext.client.request.mockResolvedValue({
        data: {
          createVenmoQRCodePaymentContext: {
            venmoQRCodePaymentContext: {
              status: "CREATED",
              id: "context-id",
              createdAt: "2021-01-20T03:25:37.522000Z",
              expiresAt: "2021-01-20T03:30:37.522000Z",
            },
          },
        },
      });
      inIframe.mockReturnValue(true);
      venmo = new Venmo({
        createPromise: Promise.resolve(testContext.client),
      });

      return venmo.getUrl().then((url) => {
        const params = querystring.parse(url);

        expect(params["x-success"]).toBe("NOOP");
        expect(params["x-cancel"]).toBe("NOOP");
        expect(params["x-error"]).toBe("NOOP");
      });
    });

    it("includes return urls when using polling flow with a deep link return url", () => {
      testContext.client.request.mockResolvedValue({
        data: {
          createVenmoQRCodePaymentContext: {
            venmoQRCodePaymentContext: {
              status: "CREATED",
              id: "context-id",
              createdAt: "2021-01-20T03:25:37.522000Z",
              expiresAt: "2021-01-20T03:30:37.522000Z",
            },
          },
        },
      });
      inIframe.mockReturnValue(true);
      venmo = new Venmo({
        deepLinkReturnUrl: "https://example.com/top-level-page",
        createPromise: Promise.resolve(testContext.client),
      });

      return venmo.getUrl().then((url) => {
        const params = querystring.parse(url);

        expect(params["x-success"]).toBe(
          "https://example.com/top-level-page#venmoSuccess=1"
        );
        expect(params["x-cancel"]).toBe(
          "https://example.com/top-level-page#venmoCancel=1"
        );
        expect(params["x-error"]).toBe(
          "https://example.com/top-level-page#venmoError=1"
        );
      });
    });

    it("omits return urls when configured to require manual return", () => {
      testContext.client.request.mockResolvedValue({
        data: {
          createVenmoQRCodePaymentContext: {
            venmoQRCodePaymentContext: {
              status: "CREATED",
              id: "context-id",
              createdAt: "2021-01-20T03:25:37.522000Z",
              expiresAt: "2021-01-20T03:30:37.522000Z",
            },
          },
        },
      });
      venmo = new Venmo({
        createPromise: Promise.resolve(testContext.client),
        requireManualReturn: true,
      });

      return venmo.getUrl().then((url) => {
        const params = querystring.parse(url);

        expect(params["x-success"]).toBe("NOOP");
        expect(params["x-cancel"]).toBe("NOOP");
        expect(params["x-error"]).toBe("NOOP");
      });
    });

    it("contains user agent in query params", () => {
      let params;
      const userAgent = window.navigator.userAgent;

      return venmo.getUrl().then((url) => {
        params = querystring.parse(url);
        expect(params.ua).toBe(userAgent);
      });
    });

    it.each([["pwv-merchant-id"], ["pwv-profile-id"]])(
      'contains correct Braintree configuration options in query params when "braintree_merchant_id" is %p',
      (merchantID) => {
        /* eslint-disable camelcase */
        const braintreeConfig = {
          braintree_merchant_id: merchantID,
          braintree_access_token: "pwv-access-token",
          braintree_environment: "sandbox",
        };

        venmo = new Venmo({
          createPromise: Promise.resolve(testContext.client),
          profileId: merchantID,
        });

        return venmo.getUrl().then((url) => {
          const params = querystring.parse(url);

          expect(params.braintree_merchant_id).toBe(
            braintreeConfig.braintree_merchant_id
          );
          expect(params.braintree_access_token).toBe(
            braintreeConfig.braintree_access_token
          );
          expect(params.braintree_environment).toBe(
            braintreeConfig.braintree_environment
          );
        });
        /* eslint-enable camelcase */
      }
    );

    // NEXT_MAJOR_VERSION should be able to remove this test
    // since we won't be using the legacy qr code mutation anymore
    it("applies mobile polling context id to pwv-access-token when it is present", () => {
      testContext.client.request.mockResolvedValue({
        data: {
          createVenmoQRCodePaymentContext: {
            venmoQRCodePaymentContext: {
              status: "CREATED",
              id: "context-id",
              createdAt: "2021-01-20T03:25:37.522000Z",
              expiresAt: "2021-01-20T03:30:37.522000Z",
            },
          },
        },
      });
      venmo = new Venmo({
        createPromise: Promise.resolve(testContext.client),
        requireManualReturn: true,
      });

      return venmo.getUrl().then((url) => {
        const params = querystring.parse(url);

        expect(params.braintree_access_token).toBe(
          "pwv-access-token|pcid:context-id"
        );
        expect(params.resource_id).toBeFalsy();
      });
    });

    it("applies mobile polling context id to resource id param when paymentMethodUsage is passed", () => {
      testContext.client.request.mockResolvedValue({
        data: {
          createVenmoPaymentContext: {
            venmoPaymentContext: {
              status: "CREATED",
              id: "context-id",
              createdAt: "2021-01-20T03:25:37.522000Z",
              expiresAt: "2021-01-20T03:30:37.522000Z",
            },
          },
        },
      });
      venmo = new Venmo({
        createPromise: Promise.resolve(testContext.client),
        paymentMethodUsage: "multi_use",
      });

      return venmo.getUrl().then((url) => {
        const params = querystring.parse(url);

        // NEXT_MAJOR_VERSION stop adding it to the access token
        // and rely on the resource id param only
        expect(params.braintree_access_token).toBe("pwv-access-token");
        expect(params.resource_id).toBe("context-id");
      });
    });

    it("contains metadata in query params to forward to Venmo", () => {
      let params, braintreeData, metadata;

      return venmo.getUrl().then((url) => {
        params = querystring.parse(url);
        braintreeData = JSON.parse(atob(params.braintree_sdk_data)); // eslint-disable-line camelcase
        metadata = braintreeData._meta;

        expect(metadata.version).toBe(VERSION);
        expect(metadata.sessionId).toBe("fakeSessionId");
        expect(metadata.integration).toBe("custom");
        expect(metadata.platform).toBe("web");
        expect(Object.keys(metadata).length).toBe(4);
      });
    });

    it("rejects if client creation rejects", () =>
      expect(
        new Venmo({
          createPromise: Promise.reject(new Error("client error")),
        }).getUrl()
      ).rejects.toThrow("client error"));
  });

  describe("processResultsFromHash", () => {
    let createOptions;

    beforeEach(() => {
      createOptions = {
        createPromise: Promise.resolve(testContext.client),
      };
      // when venmo is created with a paymentMethodUsage param, it ends
      // up creating a payment context object before it resolves.
      // This requires a lot of boilerplate scaffolding in the tests.
      // The one exception to this is when the page url has a hash
      // with tokenization results already, so in order to simplify
      // our test setup, we're just going to mock that so it will always
      // indicate that the hash has a tokenization result. It should have
      // no effect on the actual tests.
      jest
        .spyOn(Venmo.prototype, "hasTokenizationResult")
        .mockReturnValue(true);
    });

    it("uses hash from url if no hash is provided", async () => {
      const venmo = new Venmo(createOptions);

      history.replaceState(
        {},
        "",
        `${testContext.location}#venmoSuccess=1&paymentMethodNonce=nonce-from-url&username=username-from-url`
      );

      const resultFromUrl = await venmo.processResultsFromHash();
      const result = await venmo.processResultsFromHash(
        "venmoSuccess=1&paymentMethodNonce=nonce-from-argument&username=username-from-argument"
      );

      expect(resultFromUrl.paymentMethodNonce).toBe("nonce-from-url");
      expect(resultFromUrl.username).toBe("username-from-url");
      expect(result.paymentMethodNonce).toBe("nonce-from-argument");
      expect(result.username).toBe("username-from-argument");
    });

    it("sanitizes keys pulled off of hash for non-alpha characters", async () => {
      const venmo = new Venmo(createOptions);

      history.replaceState(
        {},
        "",
        `${testContext.location}#/venmoSuccess=1&paym!entMethodNonce/=abc&userna@#me=keanu`
      );

      const result = await venmo.processResultsFromHash();

      expect(result.paymentMethodNonce).toBe("abc");
      expect(result.username).toBe("keanu");
    });

    it("resolves with nonce payload on successful result", () => {
      const venmo = new Venmo(createOptions);

      return venmo
        .processResultsFromHash(
          "venmoSuccess=1&paymentMethodNonce=abc&username=keanu"
        )
        .then((payload) => {
          expect(payload.paymentMethodNonce).toBe("abc");
          expect(payload.username).toBe("keanu");
        });
    });

    it("pings for payment context status when hash params include resource id and is not using the legacy flow", async () => {
      testContext.client.request.mockResolvedValueOnce({
        data: {
          node: {
            status: "APPROVED",
            paymentMethodId: "fake-nonce-from-context",
            userName: "name-from-context",
          },
        },
      });
      createOptions.paymentMethodUsage = "single_use";

      const venmo = new Venmo(createOptions);

      const payload = await venmo.processResultsFromHash(
        "venmoSuccess=1&paymentMethodNonce=nonce-from-hash&username=name-from-hash&resource_id=context-id-from-hash"
      );

      expect(payload.paymentMethodNonce).toBe("fake-nonce-from-context");
      expect(payload.username).toBe("name-from-context");
      expect(payload.id).toBe("context-id-from-hash");
      expect(testContext.client.request).toBeCalledTimes(1);
      expect(testContext.client.request).toBeCalledWith({
        api: "graphQLApi",
        data: {
          query: expect.stringMatching("on VenmoPaymentContext"),
          variables: {
            id: "context-id-from-hash",
          },
        },
      });
    });

    it("falls back to hash value when call to ping payment context status fails", async () => {
      testContext.client.request.mockRejectedValue(new Error("network error"));
      createOptions.paymentMethodUsage = "single_use";

      const venmo = new Venmo(createOptions);

      const payload = await venmo.processResultsFromHash(
        "venmoSuccess=1&paymentMethodNonce=nonce-from-hash&username=name-from-hash&resource_id=context-id-from-hash"
      );

      expect(payload.paymentMethodNonce).toBe("nonce-from-hash");
      expect(payload.username).toBe("name-from-hash");
      expect(analytics.sendEvent).toHaveBeenCalledWith(
        expect.anything(),
        "venmo.process-results.payment-context-status-query-failed"
      );
      expect(testContext.client.request).toBeCalledTimes(1);
    });

    it("falls back to hash value when call to ping payment context status is not approved", async () => {
      testContext.client.request.mockResolvedValueOnce({
        data: {
          node: {
            status: "CREATED",
          },
        },
      });
      createOptions.paymentMethodUsage = "single_use";

      const venmo = new Venmo(createOptions);

      const payload = await venmo.processResultsFromHash(
        "venmoSuccess=1&paymentMethodNonce=nonce-from-hash&username=name-from-hash&resource_id=context-id-from-hash"
      );

      expect(payload.paymentMethodNonce).toBe("nonce-from-hash");
      expect(payload.username).toBe("name-from-hash");
      expect(analytics.sendEvent).toHaveBeenCalledWith(
        expect.anything(),
        "venmo.process-results.unexpected-payment-context-status.created"
      );
      expect(testContext.client.request).toBeCalledTimes(1);
    });

    it("resolves with nonce payload on successful result when params include a resource id but sdk is initialized to use legacy flow", () => {
      const venmo = new Venmo(createOptions);

      return venmo
        .processResultsFromHash(
          "venmoSuccess=1&paymentMethodNonce=nonce-from-hash&username=name-from-hash&resource_id=context-id-from-hash"
        )
        .then((payload) => {
          expect(payload.paymentMethodNonce).toBe("nonce-from-hash");
          expect(payload.username).toBe("name-from-hash");
        });
    });

    it("rejects with error for error result", () => {
      const venmo = new Venmo(createOptions);

      return venmo
        .processResultsFromHash(
          "venmoError=1&errorMessage=This%20is%20an%20error%20message.&errorCode=42"
        )
        .catch((err) => {
          expect(err).toBeInstanceOf(BraintreeError);
          expect(err.type).toBe("UNKNOWN");
          expect(err.code).toBe("VENMO_APP_FAILED");
          expect(err.message).toBe("Venmo app encountered a problem.");
          expect(err.details.originalError.message).toBe(
            "This is an error message."
          );
          expect(err.details.originalError.code).toBe("42");
        });
    });

    it("rejects with cancellation error on Venmo app cancel", () => {
      const venmo = new Venmo(createOptions);

      return venmo.processResultsFromHash("venmoCancel=1").catch((err) => {
        expect(err).toBeInstanceOf(BraintreeError);
        expect(err.type).toBe("CUSTOMER");
        expect(err.code).toBe("VENMO_APP_CANCELED");
        expect(err.message).toBe("Venmo app authorization was canceled.");
      });
    });

    it("rejects with cancellation error when app switch result not found", () => {
      const venmo = new Venmo(createOptions);

      return venmo.processResultsFromHash().catch((err) => {
        expect(err).toBeInstanceOf(BraintreeError);
        expect(err.type).toBe("CUSTOMER");
        expect(err.code).toBe("VENMO_CANCELED");
        expect(err.message).toBe(
          "User canceled Venmo authorization, or Venmo app is not available."
        );
      });
    });

    it("consumes URL fragment parameters on Success result", async () => {
      const venmo = new Venmo(createOptions);

      history.replaceState({}, "", `${testContext.location}#venmoSuccess=1`);

      await venmo.processResultsFromHash();

      expect(window.location.href.indexOf("#")).toBe(-1);
    });

    it.each([["Error"], ["Cancel"]])(
      "consumes URL fragment parameters on %p result",
      async (result) => {
        const venmo = new Venmo(createOptions);

        history.replaceState(
          {},
          "",
          `${testContext.location}#venmo${result}=1`
        );

        await expect(venmo.processResultsFromHash()).rejects.toThrow();

        expect(window.location.href.indexOf("#")).toBe(-1);
      }
    );

    it("does not modify history state on Success if configured", async () => {
      createOptions.ignoreHistoryChanges = true;

      const venmo = new Venmo(createOptions);

      history.replaceState({}, "", `${testContext.location}#venmoSuccess=1`);

      await venmo.processResultsFromHash();

      expect(window.location.hash).toBe("#venmoSuccess=1");
    });

    it.each([["Error"], ["Cancel"]])(
      "does not modify history state on %p result if configured",
      async (result) => {
        createOptions.ignoreHistoryChanges = true;

        const venmo = new Venmo(createOptions);

        history.replaceState(
          {},
          "",
          `${testContext.location}#venmo${result}=1`
        );

        await expect(venmo.processResultsFromHash()).rejects.toThrow();

        expect(window.location.hash).toBe(`#venmo${result}=1`);
      }
    );
  });

  describe("appSwitch", () => {
    let originalNavigator, originalLocation, venmoOptions;

    beforeEach(() => {
      venmoOptions = { createPromise: Promise.resolve(testContext.client) };

      originalNavigator = window.navigator;
      originalLocation = window.location;
      delete window.navigator;
      delete window.location;
      window.navigator = {
        platform: "platform",
      };
      window.location = {
        href: "old",
        hash: "",
      };
    });

    afterEach(() => {
      window.navigator = originalNavigator;
      window.location = originalLocation;
    });

    describe("not deep link return url", () => {
      it("calls window.open by default", async () => {
        const venmo = new Venmo(venmoOptions);

        await venmo.appSwitch("https://venmo.com/braintree");

        expect(window.open).toBeCalledWith("https://venmo.com/braintree");
        expect(analytics.sendEvent).toHaveBeenCalledWith(
          expect.anything(),
          "venmo.appswitch.start.browser"
        );
      });

      it("calls window.open when device is not ios and is configured to use ios redirect strategy", async () => {
        venmoOptions.useRedirectForIOS = true;
        jest.spyOn(browserDetection, "isIos").mockReturnValue(false);

        const venmo = new Venmo(venmoOptions);

        await venmo.appSwitch("https://venmo.com/braintree");

        expect(window.open).toBeCalledWith("https://venmo.com/braintree");
        expect(analytics.sendEvent).toHaveBeenCalledWith(
          expect.anything(),
          "venmo.appswitch.start.browser"
        );
      });

      it("calls window.open when device is ios but is not configured to use ios redirect strategy", async () => {
        jest.spyOn(browserDetection, "isIos").mockReturnValue(true);

        const venmo = new Venmo(venmoOptions);

        await venmo.appSwitch("https://venmo.com/braintree");

        expect(window.open).toBeCalledWith("https://venmo.com/braintree");
        expect(analytics.sendEvent).toHaveBeenCalledWith(
          expect.anything(),
          "venmo.appswitch.start.browser"
        );
      });

      it("sets location.href when device is ios and is configured to use ios redirect strategy", async () => {
        venmoOptions.useRedirectForIOS = true;
        jest.spyOn(browserDetection, "isIos").mockReturnValue(true);

        const venmo = new Venmo(venmoOptions);

        await venmo.appSwitch("https://venmo.com/braintree");

        expect(window.open).not.toBeCalled();
        expect(window.location.href).toBe("https://venmo.com/braintree");
        expect(analytics.sendEvent).toHaveBeenCalledWith(
          expect.anything(),
          "venmo.appswitch.start.browser"
        );
      });

      it("sets location.href when device does not support redirects on ios, even when not configured to use ios redirect strategy", async () => {
        venmoOptions.useRedirectForIOS = false;
        jest
          .spyOn(browserDetection, "doesNotSupportWindowOpenInIos")
          .mockReturnValue(true);

        const venmo = new Venmo(venmoOptions);

        await venmo.appSwitch("https://venmo.com/braintree");

        expect(window.open).not.toBeCalled();
        expect(window.location.href).toBe("https://venmo.com/braintree");
        expect(analytics.sendEvent).toHaveBeenCalledWith(
          expect.anything(),
          "venmo.appswitch.start.browser"
        );
      });
    });

    describe("deep link return url", () => {
      beforeEach(() => {
        venmoOptions.deepLinkReturnUrl = "com.braintreepayments://";
      });

      it.each([["iPhone"], ["iPad"], ["iPod"]])(
        "opens the app switch url by setting window.location.href when platform is %p",
        async (platform) => {
          const venmo = new Venmo(venmoOptions);

          window.navigator.platform = platform;

          expect(window.location.href).not.toContain(
            "https://venmo.com/braintree"
          );

          await venmo.appSwitch("https://venmo.com/braintree");

          expect(window.open).not.toBeCalled();
          expect(window.location.href).toContain("https://venmo.com/braintree");
          expect(analytics.sendEvent).toHaveBeenCalledWith(
            expect.anything(),
            "venmo.appswitch.start.ios-webview"
          );
        }
      );

      it("opens the app switch url by calling PopupBridge.open when available", async () => {
        const venmo = new Venmo(venmoOptions);

        window.popupBridge = {
          open: jest.fn(),
        };
        await venmo.appSwitch("https://venmo.com/braintree");

        expect(window.location.href).toContain("old");
        expect(window.open).not.toBeCalled();
        expect(window.popupBridge.open).toBeCalledWith(
          "https://venmo.com/braintree"
        );
        expect(analytics.sendEvent).toHaveBeenCalledWith(
          expect.anything(),
          "venmo.appswitch.start.popup-bridge"
        );

        delete window.popupBridge;
      });

      it("opens the app switch url by calling window.open otherwise", async () => {
        const venmo = new Venmo(venmoOptions);

        await venmo.appSwitch("https://venmo.com/braintree");

        expect(window.location.href).toContain("old");
        expect(window.open).toBeCalledWith("https://venmo.com/braintree");
        expect(analytics.sendEvent).toHaveBeenCalledWith(
          expect.anything(),
          "venmo.appswitch.start.webview"
        );
      });
    });
  });

  describe("isBrowserSupported", () => {
    let venmo;

    beforeEach(() => {
      venmo = new Venmo({ createPromise: Promise.resolve(testContext.client) });
      jest.spyOn(supportsVenmo, "isBrowserSupported");
    });

    it("calls isBrowserSupported library", () => {
      supportsVenmo.isBrowserSupported.mockReturnValue(true);

      expect(venmo.isBrowserSupported()).toBe(true);

      supportsVenmo.isBrowserSupported.mockReturnValue(false);

      expect(venmo.isBrowserSupported()).toBe(false);
    });

    it("calls isBrowserSupported with allowNewBrowserTab: true by default", () => {
      venmo.isBrowserSupported();

      expect(supportsVenmo.isBrowserSupported).toHaveBeenCalledWith(
        expect.objectContaining({
          allowNewBrowserTab: true,
        })
      );
    });

    it("calls isBrowserSupported with allowWebviews: true by default", () => {
      venmo.isBrowserSupported();

      expect(supportsVenmo.isBrowserSupported).toHaveBeenCalledWith(
        expect.objectContaining({
          allowWebviews: true,
        })
      );
    });

    it("calls isBrowserSupported with allowDesktop: false by default", () => {
      venmo.isBrowserSupported();

      expect(supportsVenmo.isBrowserSupported).toHaveBeenCalledWith(
        expect.objectContaining({
          allowDesktop: false,
        })
      );
    });

    it("calls isBrowserSupported with allowNewBrowserTab: false when venmo instance is configured to do so", () => {
      venmo = new Venmo({
        createPromise: Promise.resolve(testContext.client),
        allowNewBrowserTab: false,
      });

      venmo.isBrowserSupported();

      expect(supportsVenmo.isBrowserSupported).toHaveBeenCalledWith(
        expect.objectContaining({
          allowNewBrowserTab: false,
        })
      );
    });

    it("calls isBrowserSupported with allowWebviews: false when venmo instance is configured to do so", () => {
      venmo = new Venmo({
        createPromise: Promise.resolve(testContext.client),
        allowWebviews: false,
      });

      venmo.isBrowserSupported();

      expect(supportsVenmo.isBrowserSupported).toHaveBeenCalledWith(
        expect.objectContaining({
          allowWebviews: false,
        })
      );
    });

    it("calls isBrowserSupported with allowDesktop: true when venmo instance is configured to do so", () => {
      // pass a stub so create methods don't hang
      createVenmoDesktop.mockResolvedValue({});
      venmo = new Venmo({
        createPromise: Promise.resolve(testContext.client),
        allowDesktop: true,
      });

      venmo.isBrowserSupported();

      expect(supportsVenmo.isBrowserSupported).toHaveBeenCalledWith(
        expect.objectContaining({
          allowDesktop: true,
        })
      );
    });
  });

  describe("hasTokenizationResult", () => {
    let venmo;

    beforeEach(() => {
      venmo = new Venmo({ createPromise: Promise.resolve(testContext.client) });
    });

    afterEach(() => {
      history.replaceState({}, "", testContext.location);
    });

    it.each([["Success"], ["Error"], ["Cancel"]])(
      "returns true when URL has %p payload",
      (payload) => {
        history.replaceState(
          {},
          "",
          `${testContext.location}#venmo${payload}=1`
        );

        expect(venmo.hasTokenizationResult()).toBe(true);
      }
    );

    it("returns false when URL has no Venmo payload", () => {
      expect(venmo.hasTokenizationResult()).toBe(false);
    });
  });

  describe("tokenize", () => {
    it("errors if another tokenization request is active", () => {
      const venmo = new Venmo({
        createPromise: Promise.resolve(testContext.client),
      });

      venmo.tokenize();

      return venmo.tokenize().catch((err) => {
        expect(err).toBeInstanceOf(BraintreeError);
        expect(err.type).toBe("MERCHANT");
        expect(err.code).toBe("VENMO_TOKENIZATION_REQUEST_ACTIVE");
        expect(err.type).toBe("MERCHANT");
        expect(err.message).toBe("Another tokenization request is active.");
      });
    });

    describe("mobile flow with hash change listeners", () => {
      let venmo;

      beforeEach(() => {
        venmo = new Venmo({
          createPromise: Promise.resolve(testContext.client),
        });
      });

      afterEach(() => {
        /*
         * Some tests use replaceState to simulate app switch returns rather
         * than updating window.location manually because this causes errors.
         * The window state needs to be reset after those tests.
         * */
        history.replaceState({}, "", testContext.location);

        jest.runAllTimers();
      });

      it("includes paymentContextId for mobile flow with hash change listeners", () => {
        const expectedContextId = "muh-context-id-666";
        const promise = venmo.tokenize().then((resp) => {
          expect(resp.details.paymentContextId).toBe(expectedContextId);
        });

        expect.assertions(1);
        history.replaceState(
          {},
          "",
          `${testContext.location}#venmoSuccess=1&paymentMethodNonce=abc&username=keanu&id=${expectedContextId}`
        );
        triggerHashChangeHandler(venmo);

        return promise;
      });
      it("errors if getUrl fails", () => {
        jest
          .spyOn(venmo, "getUrl")
          .mockRejectedValue(new Error("client error"));

        return expect(venmo.tokenize()).rejects.toThrow("client error");
      });

      it("processes results instead of doing app switch when url has venmo results", () => {
        jest.spyOn(venmo, "processResultsFromHash");
        jest.spyOn(venmo, "appSwitch");

        history.replaceState(
          {},
          "",
          `${testContext.location}#venmoSuccess=1&paymentMethodNonce=abc&username=keanu`
        );

        return venmo.tokenize().then(() => {
          expect(venmo.processResultsFromHash).toBeCalledTimes(1);
          expect(venmo.appSwitch).not.toBeCalled();
        });
      });

      it("app switches to venmo", () => {
        jest.spyOn(venmo, "appSwitch");

        const promise = venmo.tokenize().then(() => {
          expect(venmo.appSwitch).toBeCalledTimes(1);
          expect(venmo.appSwitch).toBeCalledWith(
            expect.stringContaining("https://venmo.com/braintree")
          );
        });

        expect.assertions(2);
        history.replaceState(
          {},
          "",
          `${testContext.location}#venmoSuccess=1&paymentMethodNonce=abc&username=keanu`
        );
        triggerHashChangeHandler(venmo);

        return promise;
      });

      describe("when visibility listener triggers", () => {
        it("resolves with nonce payload on success", () => {
          jest.spyOn(venmo, "processResultsFromHash").mockResolvedValue({
            paymentMethodNonce: "abc",
            username: "keanu",
          });

          const promise = venmo.tokenize().then(({ details, nonce, type }) => {
            expect(nonce).toBe("abc");
            expect(type).toBe("VenmoAccount");
            expect(details.username).toBe("@keanu");
          });

          expect.assertions(3);
          triggerVisibilityHandler(venmo);

          return promise;
        });

        it("rejects with error on Venmo app error", () => {
          const err = new Error("fail");

          jest.spyOn(venmo, "processResultsFromHash").mockRejectedValue(err);

          const promise = venmo.tokenize().catch((tokenizeError) => {
            expect(tokenizeError).toBe(err);
          });

          triggerVisibilityHandler(venmo);

          return promise;
        });

        it("sets _tokenizationInProgress to false when app switch result not found", () => {
          const promise = venmo.tokenize().catch(() => {
            expect(venmo._tokenizationInProgress).toBe(false);
          });

          triggerVisibilityHandler(venmo);

          return promise;
        });

        it("restores the previous URL fragment after consuming Venmo results", () => {
          let promise;

          history.replaceState({}, "", `${testContext.location}#foo`);

          promise = venmo
            .tokenize()
            .catch(() => {
              jest.runAllTimers();
            })
            .then(() => {
              expect(window.location.hash).toBe("#foo");
            });

          history.replaceState({}, "", `${testContext.location}#venmoCancel=1`);

          triggerVisibilityHandler(venmo);

          return promise;
        });

        it("preserves URL if fragments are never set", () => {
          const promise = venmo.tokenize().catch(() => {
            expect(window.location.href).toBe(testContext.location);
          });

          triggerVisibilityHandler(venmo);

          return promise;
        });

        it("delays processing results by 1 second by default", () => {
          const originalTimeout = window.setTimeout;

          window.setTimeout = jest.fn().mockImplementation((fn) => {
            fn();
          });

          const promise = venmo.tokenize().then(() => {
            // document visibility change event delay
            expect(setTimeout).toBeCalledWith(expect.any(Function), 500);
            // process results
            expect(setTimeout).toBeCalledWith(expect.any(Function), 1000);

            window.setTimeout = originalTimeout;
          });

          history.replaceState(
            {},
            "",
            `${testContext.location}#venmoSuccess=1`
          );
          triggerVisibilityHandler(venmo);

          return promise;
        });

        it("can configure processing delay", () => {
          const originalTimeout = window.setTimeout;

          window.setTimeout = jest.fn().mockImplementation((fn) => {
            fn();
          });

          const promise = venmo
            .tokenize({
              processResultsDelay: 3000,
            })
            .then(() => {
              // document visibility change event delay
              expect(setTimeout).toBeCalledWith(expect.any(Function), 500);
              // process results
              expect(setTimeout).toBeCalledWith(expect.any(Function), 3000);

              window.setTimeout = originalTimeout;
            });

          history.replaceState(
            {},
            "",
            `${testContext.location}#venmoSuccess=1`
          );
          triggerVisibilityHandler(venmo);

          return promise;
        });

        it("creates a new payment context upon succesfull tokenization", async () => {
          testContext.client.request.mockResolvedValue({
            data: {
              createVenmoQRCodePaymentContext: {
                venmoQRCodePaymentContext: {
                  status: "CREATED",
                  id: "new-context-id",
                  createdAt: new Date().toString(),
                  expiresAt: new Date(Date.now() + 30000000).toString(),
                },
              },
            },
          });
          venmo._shouldCreateVenmoPaymentContext = true;
          venmo._venmoPaymentContextId = "old-context-id";

          const promise = venmo.tokenize();

          history.replaceState(
            {},
            "",
            `${testContext.location}#venmoSuccess=1`
          );
          triggerVisibilityHandler(venmo);

          await promise;

          expect(venmo._venmoPaymentContextId).toBe("new-context-id");
          expect(testContext.client.request).toBeCalledWith({
            api: "graphQLApi",
            data: expect.objectContaining({
              query: expect.stringMatching(
                "mutation CreateVenmoQRCodePaymentContext"
              ),
            }),
          });
        });

        it("creates a new payment context upon unsuccesfull tokenization", async () => {
          expect.assertions(2);

          testContext.client.request.mockResolvedValue({
            data: {
              createVenmoQRCodePaymentContext: {
                venmoQRCodePaymentContext: {
                  status: "CREATED",
                  id: "new-context-id",
                  createdAt: new Date().toString(),
                  expiresAt: new Date(Date.now() + 30000000).toString(),
                },
              },
            },
          });

          venmo._shouldCreateVenmoPaymentContext = true;
          venmo._venmoPaymentContextId = "old-context-id";

          const promise = venmo.tokenize();

          history.replaceState({}, "", `${testContext.location}#venmoCancel=1`);
          triggerVisibilityHandler(venmo);

          try {
            await promise;
          } catch (err) {
            expect(venmo._venmoPaymentContextId).toBe("new-context-id");
            expect(testContext.client.request).toBeCalledWith({
              api: "graphQLApi",
              data: expect.objectContaining({
                query: expect.stringMatching(
                  "mutation CreateVenmoQRCodePaymentContext"
                ),
              }),
            });
          }
        });
      });

      describe("analytics events", () => {
        it("sends an event that the mobile flow is used", async () => {
          const promise = venmo.tokenize();

          history.replaceState(
            {},
            "",
            `${testContext.location}#venmoSuccess=1`
          );
          triggerVisibilityHandler(venmo);

          await promise;

          expect(analytics.sendEvent).toHaveBeenCalledWith(
            expect.anything(),
            "venmo.tokenize.mobile.start"
          );
        });

        it("sends an event on app switch return Success", async () => {
          const promise = venmo.tokenize();

          history.replaceState(
            {},
            "",
            `${testContext.location}#venmoSuccess=1`
          );
          triggerVisibilityHandler(venmo);

          await promise;

          expect(analytics.sendEvent).toHaveBeenCalledWith(
            expect.anything(),
            "venmo.appswitch.handle.success"
          );
        });

        it.each([["Error"], ["Cancel"]])(
          "sends an event on app switch return %p",
          async (result) => {
            const promise = expect(venmo.tokenize()).rejects.toThrow();

            history.replaceState(
              {},
              "",
              `${testContext.location}#venmo${result}=1`
            );
            triggerVisibilityHandler(venmo);

            await promise;

            expect(analytics.sendEvent).toHaveBeenCalledWith(
              expect.anything(),
              `venmo.appswitch.handle.${result.toLowerCase()}`
            );
          }
        );

        it("sends an event when there's no app switch result before timeout", () => {
          expect.assertions(1);

          const promise = venmo.tokenize().catch(() => {
            expect(analytics.sendEvent).toHaveBeenCalledWith(
              expect.anything(),
              "venmo.appswitch.cancel-or-unavailable"
            );
          });

          triggerVisibilityHandler(venmo);

          return promise;
        });
      });
    });

    describe("mobile flow with polling", () => {
      let venmo;

      beforeEach(() => {
        jest.useRealTimers();

        testContext.client.request.mockImplementation((options) => {
          if (options.data.query.includes("mutation CreateVenmo")) {
            return Promise.resolve({
              data: {
                createVenmoQRCodePaymentContext: {
                  venmoQRCodePaymentContext: {
                    status: "CREATED",
                    id: "context-id",
                    createdAt: new Date().toString(),
                    expiresAt: new Date(Date.now() + 30000000).toString(),
                  },
                },
              },
            });
          }

          return Promise.resolve({
            data: {
              node: {
                status: "APPROVED",
              },
            },
          });
        });

        inIframe.mockReturnValue(true);
        venmo = new Venmo({
          createPromise: Promise.resolve(testContext.client),
        });
        venmo._mobilePollingInterval = 10;
        venmo._mobilePollingExpiresThreshold = 50;
      });

      it("polls for status using the legacy flow", async () => {
        testContext.client.request.mockResolvedValueOnce({
          data: {
            node: {
              status: "APPROVED",
              paymentMethodId: "fake-nonce",
              userName: "some-name",
            },
          },
        });

        await venmo.tokenize();

        expect(testContext.client.request).toBeCalledWith({
          api: "graphQLApi",
          data: {
            query: expect.stringMatching("on VenmoQRCodePaymentContext"),
            variables: {
              id: "context-id",
            },
          },
        });
      });

      it("polls for status", async () => {
        testContext.client.request.mockResolvedValueOnce({
          data: {
            node: {
              status: "APPROVED",
              paymentMethodId: "fake-nonce",
              userName: "some-name",
            },
          },
        });
        testContext.client.request.mockResolvedValue({
          data: {
            createVenmoPaymentContext: {
              venmoPaymentContext: {
                status: "CREATED",
                id: "context-id",
                createdAt: "2021-01-20T03:25:37.522000Z",
                expiresAt: "2021-01-20T03:30:37.522000Z",
              },
            },
          },
        });

        venmo._paymentMethodUsage = "single_use";
        venmo._shouldUseLegacyFlow = false;

        await venmo.tokenize();

        expect(testContext.client.request).toBeCalledWith({
          api: "graphQLApi",
          data: {
            query: expect.stringMatching("on VenmoPaymentContext"),
            variables: {
              id: "context-id",
            },
          },
        });
      });

      it("app switches to the Venmo app", async () => {
        testContext.client.request.mockResolvedValueOnce({
          data: {
            node: {
              status: "APPROVED",
              paymentMethodId: "fake-nonce",
              userName: "some-name",
            },
          },
        });

        jest.spyOn(venmo, "appSwitch");

        await venmo.tokenize();

        expect(venmo.appSwitch).toBeCalledTimes(1);
        expect(venmo.appSwitch).toBeCalledWith(
          expect.stringContaining(
            "braintree_access_token=pwv-access-token%7Cpcid%3Acontext-id"
          )
        );
      });

      it("resolves when polling concludes", async () => {
        testContext.client.request.mockResolvedValueOnce({
          data: {
            node: {
              status: "APPROVED",
              paymentMethodId: "fake-nonce",
              userName: "some-name",
            },
          },
        });

        const payload = await venmo.tokenize();

        expect(payload.nonce).toBe("fake-nonce");
        expect(payload.type).toBe("VenmoAccount");
        expect(payload.details.username).toBe("@some-name");
        expect(payload.details.paymentContextId).toBe("context-id");

        expect(analytics.sendEvent).toBeCalledWith(
          expect.anything(),
          "venmo.tokenize.manual-return.start"
        );
        expect(analytics.sendEvent).toBeCalledWith(
          expect.anything(),
          "venmo.tokenize.manual-return.success"
        );
        expect(analytics.sendEvent).toBeCalledWith(
          expect.anything(),
          "venmo.appswitch.start.browser"
        );
      });

      it("includes payerInfo if included in the query", async () => {
        testContext.client.request.mockResolvedValueOnce({
          data: {
            node: {
              status: "APPROVED",
              paymentMethodId: "fake-nonce",
              userName: "some-name",
              payerInfo: {
                userName: "some-name",
                email: "email@example.com",
                phoneNumber: "1234567890",
              },
            },
          },
        });

        const payload = await venmo.tokenize();

        expect(payload.details.payerInfo).toEqual({
          userName: "@some-name",
          email: "email@example.com",
          phoneNumber: "1234567890",
        });
      });

      it("creates a new payment context upon succesfull tokenization", async () => {
        testContext.client.request.mockResolvedValueOnce({
          data: {
            node: {
              status: "APPROVED",
              paymentMethodId: "fake-nonce",
              userName: "some-name",
            },
          },
        });
        testContext.client.request.mockResolvedValueOnce({
          data: {
            createVenmoQRCodePaymentContext: {
              venmoQRCodePaymentContext: {
                status: "CREATED",
                id: "new-context-id",
                createdAt: new Date().toString(),
                expiresAt: new Date(Date.now() + 30000000).toString(),
              },
            },
          },
        });

        expect(venmo._venmoPaymentContextId).toBe("context-id");

        await venmo.tokenize();

        expect(venmo._venmoPaymentContextId).toBe("new-context-id");
      });

      it("creates a new payment context upon unsuccesfull tokenization", async () => {
        expect.assertions(2);

        testContext.client.request.mockRejectedValueOnce(
          new Error("network error")
        );
        testContext.client.request.mockResolvedValueOnce({
          data: {
            createVenmoQRCodePaymentContext: {
              venmoQRCodePaymentContext: {
                status: "CREATED",
                id: "new-context-id",
                createdAt: new Date().toString(),
                expiresAt: new Date(Date.now() + 30000000).toString(),
              },
            },
          },
        });

        expect(venmo._venmoPaymentContextId).toBe("context-id");

        try {
          await venmo.tokenize();
        } catch (err) {
          expect(venmo._venmoPaymentContextId).toBe("new-context-id");
        }
      });

      it("rejects when a network error occurs", async () => {
        expect.assertions(4);

        const networkError = new Error("network error");

        testContext.client.request.mockRejectedValueOnce(networkError);

        await venmo.tokenize().catch((err) => {
          expect(analytics.sendEvent).not.toBeCalledWith(
            expect.anything(),
            "venmo.tokenize.manual-return.success"
          );
          expect(analytics.sendEvent).toBeCalledWith(
            expect.anything(),
            "venmo.tokenize.manual-return.failure"
          );

          expect(err.code).toBe(
            "VENMO_MOBILE_POLLING_TOKENIZATION_NETWORK_ERROR"
          );
          expect(err.details.originalError).toBe(networkError);
        });
      });

      it.each(["EXPIRED", "FAILED", "CANCELED"])(
        "rejects for %s status",
        async (status) => {
          expect.assertions(2);

          testContext.client.request.mockResolvedValueOnce({
            data: {
              node: {
                status,
              },
            },
          });

          await venmo.tokenize().catch((err) => {
            expect(err.code).toBe(
              `VENMO_MOBILE_POLLING_TOKENIZATION_${status}`
            );
            expect(analytics.sendEvent).toBeCalledWith(
              expect.anything(),
              `venmo.tokenize.manual-return.status-change.${status.toLowerCase()}`
            );
          });
        }
      );

      it("sends an analytics event for each status change", async () => {
        testContext.client.request.mockResolvedValueOnce({
          data: {
            node: {
              status: "SCANNED",
            },
          },
        });
        testContext.client.request.mockResolvedValueOnce({
          data: {
            node: {
              status: "UNKNOWN_STATUS_WE_DO_NOT_ACCOUNT_FOR",
            },
          },
        });
        testContext.client.request.mockResolvedValueOnce({
          data: {
            node: {
              status: "APPROVED",
              paymentMethodId: "fake-nonce",
              username: "some-name",
            },
          },
        });

        await venmo.tokenize();

        expect(analytics.sendEvent).toBeCalledWith(
          expect.anything(),
          "venmo.tokenize.manual-return.status-change.scanned"
        );
        expect(analytics.sendEvent).toBeCalledWith(
          expect.anything(),
          "venmo.tokenize.manual-return.status-change.unknown_status_we_do_not_account_for"
        );
        expect(analytics.sendEvent).toBeCalledWith(
          expect.anything(),
          "venmo.tokenize.manual-return.status-change.approved"
        );

        // once to create the payment context
        // three times for polling the status
        // once to create a new payment context to replace the original one
        expect(testContext.client.request).toBeCalledTimes(5);
      });

      it("rejects if polling lasts for 5 minutes with no results", async () => {
        testContext.client.request.mockImplementation((options) => {
          if (options.data.query.includes("mutation CreateVenmo")) {
            return Promise.resolve({
              data: {
                createVenmoQRCodePaymentContext: {
                  venmoQRCodePaymentContext: {
                    status: "CREATED",
                    id: "context-id",
                    createdAt: new Date().toString(),
                    expiresAt: new Date(Date.now() + 30000000).toString(),
                  },
                },
              },
            });
          }

          return Promise.resolve({
            data: {
              node: {
                status: "SCANNED",
              },
            },
          });
        });

        const promise = venmo.tokenize().catch((err) => {
          expect(err.code).toBe("VENMO_MOBILE_POLLING_TOKENIZATION_TIMEOUT");
        });

        await promise;
      });
    });

    describe("desktop flow", () => {
      let venmo, fakeVenmoDesktop;

      beforeEach(() => {
        jest.useRealTimers();

        fakeVenmoDesktop = {
          hideDesktopFlow: jest.fn().mockResolvedValue(),
          launchDesktopFlow: jest.fn().mockResolvedValue({
            paymentMethodNonce: "fake-venmo-account-nonce",
            username: "@username",
          }),
        };
        createVenmoDesktop.mockResolvedValue(fakeVenmoDesktop);
        venmo = new Venmo({
          createPromise: Promise.resolve(testContext.client),
          allowDesktop: true,
        });
      });

      it("launches the venmo desktop flow", async () => {
        await venmo.tokenize();

        expect(fakeVenmoDesktop.launchDesktopFlow).toBeCalledTimes(1);
      });

      it("sends an event that the desktop flow is started", async () => {
        await venmo.tokenize();

        expect(analytics.sendEvent).toHaveBeenCalledWith(
          expect.anything(),
          "venmo.tokenize.desktop.start"
        );
      });

      it("resolves with the nonce payload", async () => {
        const result = await venmo.tokenize();

        expect(result).toEqual({
          nonce: "fake-venmo-account-nonce",
          type: "VenmoAccount",
          details: {
            username: "@username",
          },
        });
      });

      it("sends an event when the desktop flow succeeds", async () => {
        await venmo.tokenize();

        expect(analytics.sendEvent).toHaveBeenCalledWith(
          expect.anything(),
          "venmo.tokenize.desktop.success"
        );
      });

      it("rejects when venmo desktop flow rejects", async () => {
        expect.assertions(2);

        const error = new Error("fail");

        fakeVenmoDesktop.launchDesktopFlow.mockRejectedValue(error);

        try {
          await venmo.tokenize();
        } catch (err) {
          expect(err.code).toBe("VENMO_DESKTOP_UNKNOWN_ERROR");
          expect(err.details.originalError).toBe(error);
        }
      });

      it("passes on specific desktop canceled event when customer cancels the modal", async () => {
        expect.assertions(1);

        const error = new Error("fail");

        error.reason = "CUSTOMER_CANCELED";

        fakeVenmoDesktop.launchDesktopFlow.mockRejectedValue(error);

        try {
          await venmo.tokenize();
        } catch (err) {
          expect(err.code).toBe("VENMO_DESKTOP_CANCELED");
        }
      });

      it("sends an event when the desktop flow fails", async () => {
        expect.assertions(1);

        fakeVenmoDesktop.launchDesktopFlow.mockRejectedValue(new Error("fail"));

        try {
          await venmo.tokenize();
        } catch (err) {
          expect(analytics.sendEvent).toHaveBeenCalledWith(
            expect.anything(),
            "venmo.tokenize.desktop.failure"
          );
        }
      });
    });
  });

  describe("cancelTokenization", () => {
    it("errors if no tokenization is in process", () => {
      const venmo = new Venmo({
        createPromise: Promise.resolve(testContext.client),
      });

      expect.assertions(1);

      return venmo.cancelTokenization().catch((err) => {
        expect(err.code).toBe("VENMO_TOKENIZATION_REQUEST_NOT_ACTIVE");
      });
    });

    it("rejects tokenize with an error indicating that the merchant canceled the flow", () => {
      expect.assertions(1);

      const venmo = new Venmo({
        createPromise: Promise.resolve(testContext.client),
      });

      jest.spyOn(window, "addEventListener").mockImplementation();
      jest.spyOn(window.document, "addEventListener").mockImplementation();
      jest.spyOn(window, "open").mockImplementation();

      const promise = venmo.tokenize().catch((err) => {
        expect(err.code).toBe("VENMO_TOKENIZATION_CANCELED_BY_MERCHANT");
      });

      jest.spyOn(window, "removeEventListener").mockImplementation();
      jest.spyOn(window.document, "removeEventListener").mockImplementation();

      return venmo.cancelTokenization().then(() => {
        return promise;
      });
    });

    it("removes event listeners for event listener mobile flow", () => {
      const venmo = new Venmo({
        createPromise: Promise.resolve(testContext.client),
      });

      jest.spyOn(window, "addEventListener").mockImplementation();
      jest.spyOn(window.document, "addEventListener").mockImplementation();
      jest.spyOn(window, "open").mockImplementation();

      venmo.tokenize().catch(() => {
        // noop
      });

      jest.spyOn(window, "removeEventListener").mockImplementation();
      jest.spyOn(window.document, "removeEventListener").mockImplementation();

      return venmo.cancelTokenization().then(() => {
        expect(window.removeEventListener).toBeCalledTimes(1);
        expect(window.removeEventListener).toBeCalledWith(
          "hashchange",
          expect.any(Function)
        );
        expect(window.document.removeEventListener).toBeCalledTimes(1);
        expect(window.document.removeEventListener).toBeCalledWith(
          "visibilitychange",
          expect.any(Function)
        );
      });
    });

    it("cancels the payment context in mobile polling legacy flow", () => {
      testContext.client.request.mockResolvedValue({
        data: {
          createVenmoQRCodePaymentContext: {
            venmoQRCodePaymentContext: {
              status: "CREATED",
              id: "context-id",
              createdAt: new Date().toString(),
              expiresAt: new Date(Date.now() + 30000000).toString(),
            },
          },
        },
      });

      inIframe.mockReturnValue(true);

      const venmo = new Venmo({
        createPromise: Promise.resolve(testContext.client),
      });

      venmo.tokenize().catch(() => {
        // noop
      });

      return venmo.cancelTokenization().then(() => {
        expect(testContext.client.request).toBeCalledWith({
          api: "graphQLApi",
          data: {
            query: expect.stringMatching(
              "mutation UpdateVenmoQRCodePaymentContext"
            ),
            variables: {
              input: {
                id: "context-id",
                status: "CANCELED",
              },
            },
          },
        });
      });
    });

    it("cancels the payment context in the mobile flow when paymentMethodUsage is passed", () => {
      testContext.client.request.mockResolvedValue({
        data: {
          createVenmoPaymentContext: {
            venmoPaymentContext: {
              status: "CREATED",
              id: "context-id",
              createdAt: new Date().toString(),
              expiresAt: new Date(Date.now() + 30000000).toString(),
            },
          },
        },
      });

      inIframe.mockReturnValue(true);

      const venmo = new Venmo({
        createPromise: Promise.resolve(testContext.client),
        paymentMethodUsage: "multi_use",
      });

      venmo.tokenize().catch(() => {
        // noop
      });

      return venmo.cancelTokenization().then(() => {
        expect(testContext.client.request).toBeCalledWith({
          api: "graphQLApi",
          data: {
            query: expect.stringMatching(
              "mutation UpdateVenmoPaymentContextStatus"
            ),
            variables: {
              input: {
                id: "context-id",
                status: "CANCELED",
              },
            },
          },
        });
      });
    });

    it("cancels the venmo desktop flow", () => {
      const fakeVenmoDesktop = {
        hideDesktopFlow: jest.fn().mockResolvedValue(),
        updateVenmoDesktopPaymentContext: jest.fn().mockResolvedValue(),
        launchDesktopFlow: jest.fn().mockResolvedValue({
          paymentMethodNonce: "fake-venmo-account-nonce",
          username: "@username",
        }),
      };

      createVenmoDesktop.mockResolvedValue(fakeVenmoDesktop);

      const venmo = new Venmo({
        createPromise: Promise.resolve(testContext.client),
        allowDesktop: true,
      });

      venmo.tokenize().catch(() => {
        // noop
      });

      return venmo.cancelTokenization().then(() => {
        expect(
          fakeVenmoDesktop.updateVenmoDesktopPaymentContext
        ).toBeCalledTimes(1);
        expect(
          fakeVenmoDesktop.updateVenmoDesktopPaymentContext
        ).toBeCalledWith("CANCELED");
      });
    });
  });

  describe("teardown", () => {
    let venmo;

    beforeEach(() => {
      venmo = new Venmo({ createPromise: Promise.resolve(testContext.client) });
    });

    it("removes event listener from document body", () => {
      venmo.teardown();

      expect(document.removeEventListener).toHaveBeenCalledTimes(1);
      expect(document.removeEventListener).toHaveBeenCalledWith(
        "visibilitychange",
        // eslint-disable-next-line no-undefined
        undefined
      );
    });

    it("replaces all methods so error is thrown when methods are invoked", () => {
      const instance = venmo;

      return instance.teardown().then(() => {
        methods(Venmo.prototype).forEach((method) => {
          try {
            instance[method]();
          } catch (err) {
            expect(err).toBeInstanceOf(BraintreeError);
            expect(err.type).toBe(BraintreeError.types.MERCHANT);
            expect(err.code).toBe("METHOD_CALLED_AFTER_TEARDOWN");
            expect(err.message).toBe(
              `${method} cannot be called after teardown.`
            );
          }
        });
      });
    });

    it("tears down venmo desktop instance if it exists", () => {
      const fakeVenmoDesktop = {
        teardown: jest.fn().mockResolvedValue(),
      };

      createVenmoDesktop.mockResolvedValue(fakeVenmoDesktop);
      venmo = new Venmo({
        createPromise: Promise.resolve(testContext.client),
        allowDesktop: true,
      });

      return venmo.teardown().then(() => {
        expect(fakeVenmoDesktop.teardown).toBeCalledTimes(1);
      });
    });

    it("cancels mobile polling venmo payment context if it exists using the legacy flow", async () => {
      testContext.client.request.mockResolvedValueOnce({
        data: {
          createVenmoQRCodePaymentContext: {
            venmoQRCodePaymentContext: {
              status: "CREATED",
              id: "context-id",
              createdAt: new Date().toString(),
              expiresAt: new Date(Date.now() + 30000000).toString(),
            },
          },
        },
      });

      inIframe.mockReturnValue(true);
      venmo = new Venmo({
        createPromise: Promise.resolve(testContext.client),
      });

      await flushPromises();

      return venmo.teardown().then(() => {
        expect(testContext.client.request).toBeCalledWith({
          api: "graphQLApi",
          data: {
            query: expect.stringMatching(
              "mutation UpdateVenmoQRCodePaymentContext"
            ),
            variables: {
              input: {
                id: "context-id",
                status: "CANCELED",
              },
            },
          },
        });
      });
    });

    it("cancels mobile polling venmo payment context if it exists", async () => {
      testContext.client.request.mockResolvedValueOnce({
        data: {
          createVenmoPaymentContext: {
            venmoPaymentContext: {
              status: "CREATED",
              id: "context-id",
              createdAt: new Date().toString(),
              expiresAt: new Date(Date.now() + 30000000).toString(),
            },
          },
        },
      });

      inIframe.mockReturnValue(true);
      venmo = new Venmo({
        createPromise: Promise.resolve(testContext.client),
        paymentMethodUsage: "single_use",
      });

      await flushPromises();

      return venmo.teardown().then(() => {
        expect(testContext.client.request).toBeCalledWith({
          api: "graphQLApi",
          data: {
            query: expect.stringMatching(
              "mutation UpdateVenmoPaymentContextStatus"
            ),
            variables: {
              input: {
                id: "context-id",
                status: "CANCELED",
              },
            },
          },
        });
      });
    });

    it("prevents venmo payment context from refreshing after teardown", async () => {
      testContext.client.request.mockResolvedValueOnce({
        data: {
          createVenmoPaymentContext: {
            venmoPaymentContext: {
              status: "CREATED",
              id: "context-id",
              createdAt: new Date().toString(),
              expiresAt: new Date(Date.now() + 30000000).toString(),
            },
          },
        },
      });

      inIframe.mockReturnValue(true);
      venmo = new Venmo({
        createPromise: Promise.resolve(testContext.client),
        paymentMethodUsage: "single_use",
      });

      await flushPromises();

      return venmo.teardown().then(() => {
        testContext.client.request.mockReset();

        jest.runAllTimers();

        expect(testContext.client.request).not.toBeCalledWith({
          api: "graphQLApi",
          data: expect.objectContaining({
            query: expect.stringMatching("mutation CreateVenmoPaymentContext"),
          }),
        });
      });
    });
  });
});
