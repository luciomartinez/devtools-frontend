// Copyright 2022 The Chromium Authors. All rights reserved.
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

import type * as Platform from '../../../../../front_end/core/platform/platform.js';
import * as SDK from '../../../../../front_end/core/sdk/sdk.js';
import type * as Protocol from '../../../../../front_end/generated/protocol.js';
import * as Bindings from '../../../../../front_end/models/bindings/bindings.js';
import * as Workspace from '../../../../../front_end/models/workspace/workspace.js';
import {assertNotNullOrUndefined} from '../../../../../front_end/core/platform/platform.js';
import {createTarget} from '../../helpers/EnvironmentHelpers.js';
import {describeWithMockConnection} from '../../helpers/MockConnection.js';
import {MockProtocolBackend} from '../../helpers/MockScopeChain.js';
import {encodeSourceMap} from '../../helpers/SourceMapEncoder.js';

describeWithMockConnection('CompilerScriptMapping', () => {
  let backend: MockProtocolBackend;
  let debuggerWorkspaceBinding: Bindings.DebuggerWorkspaceBinding.DebuggerWorkspaceBinding;

  beforeEach(() => {
    const targetManager = SDK.TargetManager.TargetManager.instance();
    const workspace = Workspace.Workspace.WorkspaceImpl.instance({forceNew: true});
    const resourceMapping = new Bindings.ResourceMapping.ResourceMapping(targetManager, workspace);
    debuggerWorkspaceBinding = Bindings.DebuggerWorkspaceBinding.DebuggerWorkspaceBinding.instance(
        {forceNew: true, resourceMapping, targetManager});
    backend = new MockProtocolBackend();
    Bindings.IgnoreListManager.IgnoreListManager.instance({forceNew: true, debuggerWorkspaceBinding});
  });

  const waitForUISourceCodeAdded =
      (url: string, target: SDK.Target.Target): Promise<Workspace.UISourceCode.UISourceCode> =>
          debuggerWorkspaceBinding.waitForUISourceCodeAdded(url as Platform.DevToolsPath.UrlString, target);
  const waitForUISourceCodeRemoved = (uiSourceCode: Workspace.UISourceCode.UISourceCode): Promise<void> =>
      new Promise(resolve => {
        const workspace = Workspace.Workspace.WorkspaceImpl.instance();
        const {eventType, listener} =
            workspace.addEventListener(Workspace.Workspace.Events.UISourceCodeRemoved, event => {
              if (event.data === uiSourceCode) {
                workspace.removeEventListener(eventType, listener);
                resolve();
              }
            });
      });

  it('creates UISourceCodes with the correct content type', async () => {
    const target = createTarget();

    const sourceRoot = 'http://example.com';
    const sources = ['foo.js', 'bar.ts', 'baz.jsx'];
    const scriptInfo = {url: `${sourceRoot}/bundle.js`, content: '1;\n'};
    const sourceMapInfo = {url: `${scriptInfo.url}.map`, content: {version: 3, mappings: '', sourceRoot, sources}};

    await Promise.all([
      ...sources.map(name => waitForUISourceCodeAdded(`${sourceRoot}/${name}`, target).then(uiSourceCode => {
        assert.isTrue(uiSourceCode.contentType().isFromSourceMap());
        assert.isTrue(uiSourceCode.contentType().isScript());
      })),
      backend.addScript(target, scriptInfo, sourceMapInfo),
    ]);
  });

  it('creates UISourceCodes with the correct media type', async () => {
    const target = createTarget();

    const sourceRoot = 'http://example.com';
    const scriptInfo = {
      url: `${sourceRoot}/bundle.js`,
      content: 'foo();\nbar();\nbaz();\n',
    };
    const sourceMapInfo = {
      url: `${scriptInfo.url}.map`,
      content: encodeSourceMap(['0:0 => foo.js:0:0', '1:0 => bar.ts:0:0', '2:0 => baz.jsx:0:0'], sourceRoot),
    };

    const [fooUISourceCode, barUISourceCode, bazUISourceCode] = await Promise.all([
      waitForUISourceCodeAdded(`${sourceRoot}/foo.js`, target),
      waitForUISourceCodeAdded(`${sourceRoot}/bar.ts`, target),
      waitForUISourceCodeAdded(`${sourceRoot}/baz.jsx`, target),
      backend.addScript(target, scriptInfo, sourceMapInfo),
    ]);

    assert.strictEqual(fooUISourceCode.mimeType(), 'text/javascript');
    assert.strictEqual(barUISourceCode.mimeType(), 'text/typescript');
    assert.strictEqual(bazUISourceCode.mimeType(), 'text/jsx');
  });

  it('creates UISourceCodes with the correct content and metadata', async () => {
    const target = createTarget();

    const sourceRoot = 'http://example.com';
    const sourceContent = 'const x = 1; console.log(x)';
    const scriptInfo = {
      url: `${sourceRoot}/script.min.js`,
      content: 'console.log(1);',
    };
    const sourceMapInfo = {
      url: `${scriptInfo.url}.map`,
      content: {version: 1, mappings: '', sources: ['script.js'], sourcesContent: [sourceContent], sourceRoot},
    };
    const [uiSourceCode] = await Promise.all([
      waitForUISourceCodeAdded(`${sourceRoot}/script.js`, target),
      backend.addScript(target, scriptInfo, sourceMapInfo),
    ]);

    const metadata = await uiSourceCode.requestMetadata();
    assert.strictEqual(metadata?.contentSize, sourceContent.length);

    const {content} = await uiSourceCode.requestContent();
    assert.strictEqual(content, sourceContent);
  });

  it('creates separate UISourceCodes for separate targets', async () => {
    // Create a main target and a worker child target.
    const mainTarget = createTarget({
      id: 'main' as Protocol.Target.TargetID,
      type: SDK.Target.Type.Frame,
    });
    const workerTarget = createTarget({
      id: 'worker' as Protocol.Target.TargetID,
      type: SDK.Target.Type.ServiceWorker,
      parentTarget: mainTarget,
    });

    const sourceRoot = 'http://example.com';
    const scriptInfo = {
      url: `${sourceRoot}/script.min.js`,
      content: 'console.log(1);',
    };
    const sourceMapInfo = {
      url: `${scriptInfo.url}.map`,
      content: encodeSourceMap(['0:0 => script.js:0:0'], sourceRoot),
    };

    // Register the same script for both targets, and wait until the `CompilerScriptMapping`
    // adds a UISourceCode for the `script.js` that is listed in the source map for each of
    // the two targets.
    const [mainUISourceCode, mainScript, workerUISourceCode, workerScript] = await Promise.all([
      waitForUISourceCodeAdded(`${sourceRoot}/script.js`, mainTarget),
      backend.addScript(mainTarget, scriptInfo, sourceMapInfo),
      waitForUISourceCodeAdded(`${sourceRoot}/script.js`, workerTarget),
      backend.addScript(workerTarget, scriptInfo, sourceMapInfo),
    ]);

    assert.notStrictEqual(mainUISourceCode, workerUISourceCode);
    for (const {script, uiSourceCode} of
             [{script: mainScript, uiSourceCode: mainUISourceCode},
              {script: workerScript, uiSourceCode: workerUISourceCode}]) {
      const rawLocations = await debuggerWorkspaceBinding.uiLocationToRawLocations(uiSourceCode, 0, 0);
      assert.lengthOf(rawLocations, 1);
      const [rawLocation] = rawLocations;
      assert.strictEqual(rawLocation.script(), script);
      const uiLocation = await debuggerWorkspaceBinding.rawLocationToUILocation(rawLocation);
      assertNotNullOrUndefined(uiLocation);
      assert.strictEqual(uiLocation.uiSourceCode, uiSourceCode);
    }
  });

  it('creates separate UISourceCodes for content scripts', async () => {
    const target = createTarget();

    const sourceRoot = 'http://example.com';
    const scriptInfo = {
      url: `${sourceRoot}/script.min.js`,
      content: 'console.log(1);',
    };
    const sourceMapInfo = {
      url: `${scriptInfo.url}.map`,
      content: encodeSourceMap(['0:0 => script.js:0:0'], sourceRoot),
    };

    // Register `script.min.js` as regular script first.
    const regularScriptInfo = {...scriptInfo, isContentScript: false};
    const [regularUISourceCode, regularScript] = await Promise.all([
      waitForUISourceCodeAdded(`${sourceRoot}/script.js`, target),
      backend.addScript(target, regularScriptInfo, sourceMapInfo),
    ]);

    // Now register the same `script.min.js` as content script.
    const contentScriptInfo = {...scriptInfo, isContentScript: true};
    const [contentUISourceCode, contentScript] = await Promise.all([
      waitForUISourceCodeAdded(`${sourceRoot}/script.js`, target),
      backend.addScript(target, contentScriptInfo, sourceMapInfo),
    ]);

    assert.notStrictEqual(regularUISourceCode, contentUISourceCode);
    for (const {script, uiSourceCode} of
             [{script: regularScript, uiSourceCode: regularUISourceCode},
              {script: contentScript, uiSourceCode: contentUISourceCode}]) {
      const rawLocations = await debuggerWorkspaceBinding.uiLocationToRawLocations(uiSourceCode, 0, 0);
      assert.lengthOf(rawLocations, 1);
      const [rawLocation] = rawLocations;
      assert.strictEqual(rawLocation.script(), script);
      const uiLocation = await debuggerWorkspaceBinding.rawLocationToUILocation(rawLocation);
      assertNotNullOrUndefined(uiLocation);
      assert.strictEqual(uiLocation.uiSourceCode, uiSourceCode);
    }
  });

  it('correctly marks known 3rdparty UISourceCodes', async () => {
    const target = createTarget();

    const sourceRoot = 'http://example.com';
    const scriptInfo = {
      url: `${sourceRoot}/bundle.js`,
      content: '1;\n',
    };
    const sourceMapInfo = {
      url: `${scriptInfo.url}.map`,
      content: {
        version: 3,
        mappings: '',
        sourceRoot,
        sources: ['app.ts', 'lib.ts'],
        x_google_ignoreList: [1],
      },
    };

    await Promise.all([
      waitForUISourceCodeAdded(`${sourceRoot}/app.ts`, target).then(uiSourceCode => {
        assert.isFalse(uiSourceCode.isKnownThirdParty(), '`app.ts` is not a known 3rdparty script');
      }),
      waitForUISourceCodeAdded(`${sourceRoot}/lib.ts`, target).then(uiSourceCode => {
        assert.isTrue(uiSourceCode.isKnownThirdParty(), '`lib.ts` is a known 3rdparty script');
      }),
      backend.addScript(target, scriptInfo, sourceMapInfo),
    ]);
  });

  describe('supports modern Web development workflows', () => {
    it('supports webpack code splitting', async () => {
      // This is basically the "Shared code with webpack entry point code-splitting" scenario
      // outlined in http://go/devtools-source-identities, where two routes (`route1.ts` and
      // `route2.ts`) share some common code (`shared.ts`), and webpack is configured to spit
      // out a dedicated bundle for each route (`route1.js` and `route2.js`). The demo can be
      // found at https://devtools-source-identities.glitch.me/webpack-code-split/ for further
      // reference.
      const target = createTarget();
      const sourceRoot = 'webpack:///src';

      // Load the script and source map for the first route.
      const route1ScriptInfo = {
        url: 'http://example.com/route1.js',
        content: 'function f(x){}\nf(1)',
      };
      const route1SourceMapInfo = {
        url: `${route1ScriptInfo.url}.map`,
        content: encodeSourceMap(['0:0 => shared.ts:0:0', '1:0 => route1.ts:0:0'], sourceRoot),
      };
      const [route1UISourceCode, sharedUISourceCode, route1Script] = await Promise.all([
        waitForUISourceCodeAdded(`${sourceRoot}/route1.ts`, target),
        waitForUISourceCodeAdded(`${sourceRoot}/shared.ts`, target),
        backend.addScript(target, route1ScriptInfo, route1SourceMapInfo),
      ]);

      // Both `route1.ts` and `shared.ts` are referred to only by `route1.js` at this point.
      assert.deepEqual(await debuggerWorkspaceBinding.uiLocationToRawLocations(route1UISourceCode, 0), [
        route1Script.debuggerModel.createRawLocation(route1Script, 1, 0),
      ]);
      assert.deepEqual(await debuggerWorkspaceBinding.uiLocationToRawLocations(sharedUISourceCode, 0), [
        route1Script.debuggerModel.createRawLocation(route1Script, 0, 0),
      ]);

      // Load the script and source map for the second route.
      const route2ScriptInfo = {
        url: 'http://example.com/route2.js',
        content: 'function f(x){}\nf(2)',
      };
      const route2SourceMapInfo = {
        url: `${route2ScriptInfo.url}.map`,
        content: encodeSourceMap(['0:0 => shared.ts:0:0', '1:0 => route2.ts:0:0'], sourceRoot),
      };
      const [route2UISourceCode, route2Script] = await Promise.all([
        waitForUISourceCodeAdded(`${sourceRoot}/route2.ts`, target),
        backend.addScript(target, route2ScriptInfo, route2SourceMapInfo),
      ]);

      // Now `route1.ts` is provided exclusively by `route1.js`...
      const route1UILocation = route1UISourceCode.uiLocation(0, 0);
      const route1Locations = await debuggerWorkspaceBinding.uiLocationToRawLocations(
          route1UILocation.uiSourceCode, route1UILocation.lineNumber, route1UILocation.columnNumber);
      assert.lengthOf(route1Locations, 1);
      const [route1Location] = route1Locations;
      assert.strictEqual(route1Location.script(), route1Script);
      assert.deepEqual(await debuggerWorkspaceBinding.rawLocationToUILocation(route1Location), route1UILocation);

      // ...and `route2.ts` is provided exclusively by `route2.js`...
      const route2UILocation = route2UISourceCode.uiLocation(0, 0);
      const route2Locations = await debuggerWorkspaceBinding.uiLocationToRawLocations(
          route2UILocation.uiSourceCode, route2UILocation.lineNumber, route2UILocation.columnNumber);
      assert.lengthOf(route2Locations, 1);
      const [route2Location] = route2Locations;
      assert.strictEqual(route2Location.script(), route2Script);
      assert.deepEqual(await debuggerWorkspaceBinding.rawLocationToUILocation(route2Location), route2UILocation);

      // ...but `shared.ts` is provided by both `route1.js` and `route2.js`.
      const sharedUILocation = sharedUISourceCode.uiLocation(0, 0);
      const sharedLocations = await debuggerWorkspaceBinding.uiLocationToRawLocations(
          sharedUILocation.uiSourceCode, sharedUILocation.lineNumber, sharedUILocation.columnNumber);
      assert.sameMembers(sharedLocations.map(location => location.script()), [route1Script, route2Script]);
      for (const location of sharedLocations) {
        assert.deepEqual(await debuggerWorkspaceBinding.rawLocationToUILocation(location), sharedUILocation);
      }
    });

    // Currently the CompilerScriptMapping does not properly update mappings to support
    // webpack's hot module replacement machinery.
    it.skip('[crbug.com/1403432]: supports webpack hot module replacement', async () => {
      const target = createTarget();
      const sourceRoot = 'webpack:///src';

      // Load the original bundle.
      const originalScriptInfo = {
        url: 'http://example.com/bundle.js',
        content: 'const f = console.log;\nf("Hello from the original bundle");',
      };
      const originalSourceMapInfo = {
        url: `${originalScriptInfo.url}.map`,
        content: encodeSourceMap(
            [
              '0:0 => lib.js:0:0',
              'lib.js: const f = console.log;',
              '1:0 => app.js:0:0',
              'app.js: f("Hello from the original bundle")',
            ],
            sourceRoot),
      };
      const [originalLibUISourceCode, originalAppUISourceCode, originalScript] = await Promise.all([
        waitForUISourceCodeAdded(`${sourceRoot}/lib.js`, target),
        waitForUISourceCodeAdded(`${sourceRoot}/app.js`, target),
        backend.addScript(target, originalScriptInfo, originalSourceMapInfo),
      ]);

      // Initially the original `bundle.js` maps to the original `app.js` and `lib.js`.
      assert.deepEqual(
          await debuggerWorkspaceBinding.rawLocationToUILocation(
              originalScript.debuggerModel.createRawLocation(originalScript, 0, 0)),
          originalLibUISourceCode.uiLocation(0, 0));
      assert.deepEqual(
          await debuggerWorkspaceBinding.rawLocationToUILocation(
              originalScript.debuggerModel.createRawLocation(originalScript, 1, 0)),
          originalAppUISourceCode.uiLocation(0, 0));

      // Inject the HMR update script.
      const updateScriptInfo = {
        url: 'http://example.com/hot.update.1234.js',
        content: 'f("Hello from the update");',
      };
      const updateSourceMapInfo = {
        url: `${updateScriptInfo.url}.map`,
        content: encodeSourceMap(
            [
              '0:0 => app.js:0:0',
              'lib.js: const f = console.log;',
              'app.js: f("Hello from the update")',
            ],
            sourceRoot),
      };
      const [updateAppUISourceCode, , updateScript] = await Promise.all([
        waitForUISourceCodeAdded(`${sourceRoot}/app.js`, target),
        // The original `app.js` should disappear as part of the HMR update.
        waitForUISourceCodeRemoved(originalAppUISourceCode),
        backend.addScript(target, updateScriptInfo, updateSourceMapInfo),
      ]);

      // Now we have a new `app.js`...
      assert.notStrictEqual(updateAppUISourceCode, originalAppUISourceCode);
      assert.isEmpty(await debuggerWorkspaceBinding.uiLocationToRawLocations(originalAppUISourceCode, 0, 0));
      assert.deepEqual(await debuggerWorkspaceBinding.uiLocationToRawLocations(updateAppUISourceCode, 0, 0), [
        updateScript.debuggerModel.createRawLocation(updateScript, 0, 0),
      ]);

      // ...and the `app.js` mapping of the `bundle.js` is now gone...
      const uiLocation = await debuggerWorkspaceBinding.rawLocationToUILocation(
          originalScript.debuggerModel.createRawLocation(originalScript, 1, 0));
      assertNotNullOrUndefined(uiLocation);
      assert.notStrictEqual(uiLocation.uiSourceCode, originalAppUISourceCode);
      assert.notStrictEqual(uiLocation.uiSourceCode, updateAppUISourceCode);

      // ...while the `lib.js` mapping of `bundle.js` is still intact (because it
      // was the same content).
      assert.deepEqual(
          await debuggerWorkspaceBinding.rawLocationToUILocation(
              originalScript.debuggerModel.createRawLocation(originalScript, 0, 0)),
          originalLibUISourceCode.uiLocation(0, 0));
    });
  });
});
