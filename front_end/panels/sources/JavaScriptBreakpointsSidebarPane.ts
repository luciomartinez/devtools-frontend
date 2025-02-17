// Copyright (c) 2015 The Chromium Authors. All rights reserved.
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

import * as Common from '../../core/common/common.js';
import * as i18n from '../../core/i18n/i18n.js';
import * as Platform from '../../core/platform/platform.js';
import * as SDK from '../../core/sdk/sdk.js';
import * as Bindings from '../../models/bindings/bindings.js';
import * as TextUtils from '../../models/text_utils/text_utils.js';
import * as Workspace from '../../models/workspace/workspace.js';
import * as UI from '../../ui/legacy/legacy.js';
import {LogpointPrefix} from './BreakpointEditDialog.js';

import javaScriptBreakpointsSidebarPaneStyles from './javaScriptBreakpointsSidebarPane.css.js';

const UIStrings = {
  /**
   *@description Text to indicate there are no breakpoints
   */
  noBreakpoints: 'No breakpoints',
  /**
   *@description Text exposed to screen readers on checked items.
   */
  checked: 'checked',
  /**
   *@description Accessible text exposed to screen readers when the screen reader encounters an unchecked checkbox.
   */
  unchecked: 'unchecked',
  /**
   *@description Accessible text for a breakpoint collection with a combination of checked states.
   */
  mixed: 'mixed',
  /**
   *@description Accessibility label for hit breakpoints in the Sources panel.
   *@example {checked} PH1
   */
  sBreakpointHit: '{PH1} breakpoint hit',
  /**
   *@description Text in Debugger Plugin of the Sources panel
   */
  removeAllBreakpointsInLine: 'Remove all breakpoints in line',
  /**
   *@description Text to remove a breakpoint
   */
  removeBreakpoint: 'Remove breakpoint',
  /**
   *@description Context menu item that reveals the source code location of a breakpoint in the Sources panel.
   */
  revealLocation: 'Reveal location',
  /**
   *@description Text in Java Script Breakpoints Sidebar Pane of the Sources panel
   */
  deactivateBreakpoints: 'Deactivate breakpoints',
  /**
   *@description Text in Java Script Breakpoints Sidebar Pane of the Sources panel
   */
  activateBreakpoints: 'Activate breakpoints',
  /**
   *@description Text in Java Script Breakpoints Sidebar Pane of the Sources panel
   */
  enableAllBreakpoints: 'Enable all breakpoints',
  /**
   *@description Text in Java Script Breakpoints Sidebar Pane of the Sources panel
   */
  enableBreakpointsInFile: 'Enable breakpoints in file',
  /**
   *@description Text in Java Script Breakpoints Sidebar Pane of the Sources panel
   */
  disableAllBreakpoints: 'Disable all breakpoints',
  /**
   *@description Text in Java Script Breakpoints Sidebar Pane of the Sources panel
   */
  disableBreakpointsInFile: 'Disable breakpoints in file',
  /**
   *@description Text to remove all breakpoints
   */
  removeAllBreakpoints: 'Remove all breakpoints',
  /**
   *@description Text in Java Script Breakpoints Sidebar Pane of the Sources panel
   */
  removeOtherBreakpoints: 'Remove other breakpoints',
};
const str_ = i18n.i18n.registerUIStrings('panels/sources/JavaScriptBreakpointsSidebarPane.ts', UIStrings);
const i18nString = i18n.i18n.getLocalizedString.bind(undefined, str_);
let javaScriptBreakpointsSidebarPaneInstance: JavaScriptBreakpointsSidebarPane;

export class JavaScriptBreakpointsSidebarPane extends UI.ThrottledWidget.ThrottledWidget implements
    UI.ContextFlavorListener.ContextFlavorListener, UI.ListControl.ListDelegate<BreakpointItem> {
  private readonly breakpointManager: Bindings.BreakpointManager.BreakpointManager;
  private breakpoints: UI.ListModel.ListModel<BreakpointItem>;
  private list: UI.ListControl.ListControl<BreakpointItem>;
  private readonly emptyElement: HTMLElement;

  private constructor() {
    super(true);

    this.breakpointManager = Bindings.BreakpointManager.BreakpointManager.instance();
    this.breakpointManager.addEventListener(Bindings.BreakpointManager.Events.BreakpointAdded, this.update, this);
    this.breakpointManager.addEventListener(Bindings.BreakpointManager.Events.BreakpointRemoved, this.update, this);
    Common.Settings.Settings.instance().moduleSetting('breakpointsActive').addChangeListener(this.update, this);

    this.breakpoints = new UI.ListModel.ListModel();
    this.list = new UI.ListControl.ListControl(this.breakpoints, this, UI.ListControl.ListMode.NonViewport);
    UI.ARIAUtils.markAsList(this.list.element);
    this.contentElement.appendChild(this.list.element);

    this.emptyElement = this.contentElement.createChild('div', 'gray-info-message');
    this.emptyElement.textContent = i18nString(UIStrings.noBreakpoints);
    this.emptyElement.tabIndex = -1;

    this.update();
  }

  static instance(): JavaScriptBreakpointsSidebarPane {
    if (!javaScriptBreakpointsSidebarPaneInstance) {
      javaScriptBreakpointsSidebarPaneInstance = new JavaScriptBreakpointsSidebarPane();
    }
    return javaScriptBreakpointsSidebarPaneInstance;
  }

  private getBreakpointLocations(): BreakpointLocation[] {
    const locations = this.breakpointManager.allBreakpointLocations().filter(
        breakpointLocation =>
            breakpointLocation.uiLocation.uiSourceCode.project().type() !== Workspace.Workspace.projectTypes.Debugger);

    locations.sort((item1, item2) => item1.uiLocation.compareTo(item2.uiLocation));

    const result = [];
    let lastBreakpoint: Bindings.BreakpointManager.Breakpoint|null = null;
    let lastLocation: Workspace.UISourceCode.UILocation|null = null;
    for (const location of locations) {
      if (location.breakpoint !== lastBreakpoint || (lastLocation && location.uiLocation.compareTo(lastLocation))) {
        result.push(location);
        lastBreakpoint = location.breakpoint;
        lastLocation = location.uiLocation;
      }
    }
    return result;
  }

  private hideList(): void {
    this.list.element.classList.add('hidden');
    this.emptyElement.classList.remove('hidden');
  }

  private ensureListShown(): void {
    this.list.element.classList.remove('hidden');
    this.emptyElement.classList.add('hidden');
  }

  private groupBreakpointLocationsById(breakpointLocations: BreakpointLocation[]): BreakpointLocation[][] {
    const map = new Platform.MapUtilities.Multimap<string, BreakpointLocation>();
    for (const breakpointLocation of breakpointLocations) {
      const uiLocation = breakpointLocation.uiLocation;
      map.set(uiLocation.id(), breakpointLocation);
    }
    const arr: BreakpointLocation[][] = [];
    for (const id of map.keysArray()) {
      const locations = Array.from(map.get(id));
      if (locations.length) {
        arr.push(locations);
      }
    }
    return arr;
  }

  private getLocationIdsByLineId(breakpointLocations: BreakpointLocation[]):
      Platform.MapUtilities.Multimap<string, string> {
    const result = new Platform.MapUtilities.Multimap<string, string>();

    for (const breakpointLocation of breakpointLocations) {
      const uiLocation = breakpointLocation.uiLocation;
      result.set(uiLocation.lineId(), uiLocation.id());
    }

    return result;
  }

  private async getSelectedUILocation(): Promise<Workspace.UISourceCode.UILocation|null> {
    const details = UI.Context.Context.instance().flavor(SDK.DebuggerModel.DebuggerPausedDetails);
    if (details && details.callFrames.length) {
      return await Bindings.DebuggerWorkspaceBinding.DebuggerWorkspaceBinding.instance().rawLocationToUILocation(
          details.callFrames[0].location());
    }
    return null;
  }

  private getContent(locations: BreakpointLocation[][]): Promise<TextUtils.Text.Text[]> {
    // Use a cache to share the Text objects between all breakpoints. This way
    // we share the cached line ending information that Text calculates. This
    // was very slow to calculate with a lot of breakpoints in the same very
    // large source file.
    const contentToTextMap = new Map<string, TextUtils.Text.Text>();

    return Promise.all(locations.map(async ([{uiLocation: {uiSourceCode}}]) => {
      if (uiSourceCode.mimeType() === 'application/wasm') {
        // We could mirror the logic from `SourceFrame._ensureContentLoaded()` here
        // (and if so, ideally share that code somewhere), but that's quite heavy
        // logic just to display a single Wasm instruction. Also not really clear
        // how much value this would add. So let's keep it simple for now and don't
        // display anything additional for Wasm breakpoints, and if there's demand
        // to display some text preview, we could look into selectively disassemb-
        // ling the part of the text that we need here.
        // Relevant crbug: https://crbug.com/1090256
        return new TextUtils.Text.Text('');
      }
      const {content} = await uiSourceCode.requestContent();
      const contentText = content || '';
      if (contentToTextMap.has(contentText)) {
        return contentToTextMap.get(contentText) as TextUtils.Text.Text;
      }
      const text = new TextUtils.Text.Text(contentText);
      contentToTextMap.set(contentText, text);
      return text;
    }));
  }

  async doUpdate(): Promise<void> {
    const hadFocus = this.hasFocus();
    const breakpointLocations = this.getBreakpointLocations();
    if (!breakpointLocations.length) {
      this.hideList();
      this.setBreakpointItems([]);
      return this.didUpdateForTest();
    }
    this.ensureListShown();

    const locationsGroupedById = this.groupBreakpointLocationsById(breakpointLocations);
    const locationIdsByLineId = this.getLocationIdsByLineId(breakpointLocations);
    const content = await this.getContent(locationsGroupedById);
    const selectedUILocation = await this.getSelectedUILocation();
    const breakpoints = [];
    for (let idx = 0; idx < locationsGroupedById.length; idx++) {
      const locations = locationsGroupedById[idx];
      const breakpointLocation = locations[0];
      const uiLocation = breakpointLocation.uiLocation;
      const isSelected = selectedUILocation !== null &&
          locations.some(location => location.uiLocation.id() === selectedUILocation.id());
      // Wasm disassembly bytecode offsets are stored as column numbers,
      // so this showColumn setting doesn't make sense for WebAssembly.
      const showColumn = uiLocation.uiSourceCode.mimeType() !== 'application/wasm' &&
          locationIdsByLineId.get(uiLocation.lineId()).size > 1;
      const text = (content[idx] as TextUtils.Text.Text);
      breakpoints.push(new BreakpointItem(locations, text, isSelected, showColumn));
    }

    if (breakpoints.some(breakpoint => breakpoint.isSelected)) {
      void UI.ViewManager.ViewManager.instance().showView('sources.jsBreakpoints');
    }

    this.list.element.classList.toggle(
        'breakpoints-list-deactivated', !Common.Settings.Settings.instance().moduleSetting('breakpointsActive').get());

    this.setBreakpointItems(breakpoints);

    if (hadFocus) {
      this.focus();
    }

    return this.didUpdateForTest();
  }

  /**
   * If the number of breakpoint items is the same,
   * we expect only minor changes and it implies that only
   * few items should be updated
   */
  private setBreakpointItems(breakpointItems: BreakpointItem[]): void {
    if (this.breakpoints.length === breakpointItems.length) {
      for (let i = 0; i < this.breakpoints.length; i++) {
        if (!this.breakpoints.at(i).isSimilar(breakpointItems[i])) {
          this.breakpoints.replace(i, breakpointItems[i], /** keepSelectedIndex= */ true);
        }
      }
    } else {
      this.breakpoints.replaceAll(breakpointItems);
    }
    if (!this.list.selectedItem() && this.breakpoints.at(0)) {
      this.list.selectItem(this.breakpoints.at(0));
    }
  }

  createElementForItem(item: BreakpointItem): Element {
    const element = document.createElement('div');
    element.classList.add('breakpoint-entry');
    UI.ARIAUtils.markAsListitem(element);
    element.tabIndex = this.list.selectedItem() === item ? 0 : -1;
    element.addEventListener('contextmenu', this.breakpointContextMenu.bind(this), true);
    element.addEventListener('click', this.revealLocation.bind(this, element), false);

    const hasLogpoint = item.locations.some(location => location.breakpoint.condition().includes(LogpointPrefix));
    const hasConditional = item.locations.some(location => Boolean(location.breakpoint.condition()));
    const lineElement = element.createChild('div', 'decoration-and-content');
    if (hasLogpoint) {
      lineElement.classList.add('logpoint');
    } else if (hasConditional) {
      lineElement.classList.add('breakpoint-conditional');
    }

    const checkboxLabel = UI.UIUtils.CheckboxLabel.create('');
    const uiLocation = item.locations[0].uiLocation;
    const hasEnabled = item.locations.some(location => location.breakpoint.enabled());
    const hasDisabled = item.locations.some(location => !location.breakpoint.enabled());
    checkboxLabel.textElement.textContent = uiLocation.linkText() +
        (item.showColumn && typeof uiLocation.columnNumber === 'number' ? ':' + (uiLocation.columnNumber + 1) : '');
    checkboxLabel.checkboxElement.checked = hasEnabled;
    checkboxLabel.checkboxElement.indeterminate = hasEnabled && hasDisabled;
    checkboxLabel.checkboxElement.tabIndex = -1;
    checkboxLabel.addEventListener('click', this.breakpointCheckboxClicked.bind(this), false);
    lineElement.appendChild(checkboxLabel);
    let checkedDescription: Common.UIString.LocalizedString =
        hasEnabled ? i18nString(UIStrings.checked) : i18nString(UIStrings.unchecked);
    if (hasEnabled && hasDisabled) {
      checkedDescription = i18nString(UIStrings.mixed);
    }
    if (item.isSelected) {
      UI.ARIAUtils.setDescription(lineElement, i18nString(UIStrings.sBreakpointHit, {PH1: checkedDescription}));
      element.classList.add('breakpoint-hit');
      this.setDefaultFocusedElement(element);
    } else {
      UI.ARIAUtils.setDescription(lineElement, checkedDescription);
    }

    element.addEventListener('keydown', event => {
      if (event.key === ' ') {
        checkboxLabel.checkboxElement.click();
        event.consume(true);
      }
    });

    const snippetElement = lineElement.createChild('div', 'source-text monospace');
    const lineNumber = uiLocation.lineNumber;

    if (item.text && lineNumber < item.text.lineCount()) {
      const lineText = item.text.lineAt(lineNumber);
      const maxSnippetLength = 200;
      snippetElement.textContent = Platform.StringUtilities.trimEndWithMaxLength(
          lineText.substring(item.showColumn ? (uiLocation.columnNumber || 0) : 0), maxSnippetLength);
    }

    elementToBreakpointMap.set(element, item.locations);
    elementToUILocationMap.set(element, uiLocation);
    return element;
  }

  heightForItem(_item: BreakpointItem): number {
    return 0;
  }

  isItemSelectable(_item: BreakpointItem): boolean {
    return true;
  }

  selectedItemChanged(
      _from: BreakpointItem|null, _to: BreakpointItem|null, fromElement: HTMLElement|null,
      toElement: HTMLElement|null): void {
    if (fromElement) {
      fromElement.tabIndex = -1;
    }
    if (toElement) {
      toElement.tabIndex = 0;
      this.setDefaultFocusedElement(toElement);
      if (this.hasFocus()) {
        toElement.focus();
      }
    }
  }

  updateSelectedItemARIA(_fromElement: Element|null, _toElement: Element|null): boolean {
    return true;
  }

  private breakpointLocations(event: Event): Bindings.BreakpointManager.BreakpointLocation[] {
    if (event.target instanceof Element) {
      return this.breakpointLocationsForElement(event.target);
    }
    return [];
  }

  private breakpointLocationsForElement(element: Element): Bindings.BreakpointManager.BreakpointLocation[] {
    const node = element.enclosingNodeOrSelfWithClass('breakpoint-entry');
    if (!node) {
      return [];
    }
    return elementToBreakpointMap.get(node) || [];
  }

  private breakpointCheckboxClicked(event: Event): void {
    const hadFocus = this.hasFocus();
    const breakpoints = this.breakpointLocations(event).map(breakpointLocation => breakpointLocation.breakpoint);
    const newState = (event.target as UI.UIUtils.CheckboxLabel).checkboxElement.checked;
    for (const breakpoint of breakpoints) {
      breakpoint.setEnabled(newState);
      const item =
          this.breakpoints.find(breakpointItem => breakpointItem.locations.some(loc => loc.breakpoint === breakpoint));
      if (item) {
        this.list.selectItem(item);
        this.list.refreshItem(item);
      }
    }
    if (hadFocus) {
      this.focus();
    }
    event.consume();
  }

  private revealLocation(element: Element): void {
    const uiLocations =
        this.breakpointLocationsForElement(element).map(breakpointLocation => breakpointLocation.uiLocation);
    let uiLocation: Workspace.UISourceCode.UILocation|null = null;
    for (const uiLocationCandidate of uiLocations) {
      if (!uiLocation || uiLocationCandidate.compareTo(uiLocation) < 0) {
        uiLocation = uiLocationCandidate;
      }
    }
    if (uiLocation) {
      void Common.Revealer.reveal(uiLocation);
    }
  }

  private breakpointContextMenu(event: Event): void {
    const breakpoints = this.breakpointLocations(event).map(breakpointLocation => breakpointLocation.breakpoint);

    const contextMenu = new UI.ContextMenu.ContextMenu(event);
    const removeEntryTitle = breakpoints.length > 1 ? i18nString(UIStrings.removeAllBreakpointsInLine) :
                                                      i18nString(UIStrings.removeBreakpoint);
    contextMenu.defaultSection().appendItem(
        removeEntryTitle, () => breakpoints.map(breakpoint => void breakpoint.remove(false /* keepInStorage */)));
    if (event.target instanceof Element) {
      contextMenu.defaultSection().appendItem(
          i18nString(UIStrings.revealLocation), this.revealLocation.bind(this, event.target));
    }

    const breakpointActive = Common.Settings.Settings.instance().moduleSetting('breakpointsActive').get();
    const breakpointActiveTitle =
        breakpointActive ? i18nString(UIStrings.deactivateBreakpoints) : i18nString(UIStrings.activateBreakpoints);
    contextMenu.defaultSection().appendItem(
        breakpointActiveTitle,
        () => Common.Settings.Settings.instance().moduleSetting('breakpointsActive').set(!breakpointActive));

    if (breakpoints.some(breakpoint => !breakpoint.enabled())) {
      const enableTitle = i18nString(UIStrings.enableAllBreakpoints);
      contextMenu.defaultSection().appendItem(enableTitle, this.toggleAllBreakpoints.bind(this, true));
      if (event.target instanceof Element) {
        const enableInFileTitle = i18nString(UIStrings.enableBreakpointsInFile);
        contextMenu.defaultSection().appendItem(
            enableInFileTitle, this.toggleAllBreakpointsInFile.bind(this, event.target, true));
      }
    }
    if (breakpoints.some(breakpoint => breakpoint.enabled())) {
      const disableTitle = i18nString(UIStrings.disableAllBreakpoints);
      contextMenu.defaultSection().appendItem(disableTitle, this.toggleAllBreakpoints.bind(this, false));
      if (event.target instanceof Element) {
        const disableInFileTitle = i18nString(UIStrings.disableBreakpointsInFile);
        contextMenu.defaultSection().appendItem(
            disableInFileTitle, this.toggleAllBreakpointsInFile.bind(this, event.target, false));
      }
    }

    const removeAllTitle = i18nString(UIStrings.removeAllBreakpoints);
    contextMenu.defaultSection().appendItem(removeAllTitle, this.removeAllBreakpoints.bind(this));
    const removeOtherTitle = i18nString(UIStrings.removeOtherBreakpoints);
    contextMenu.defaultSection().appendItem(
        removeOtherTitle, this.removeOtherBreakpoints.bind(this, new Set(breakpoints)));
    void contextMenu.show();
  }

  private toggleAllBreakpointsInFile(element: Element, toggleState: boolean): void {
    const breakpointLocations = this.getBreakpointLocations();
    const selectedBreakpointLocations = this.breakpointLocationsForElement(element);
    breakpointLocations.forEach(breakpointLocation => {
      const matchesLocation = selectedBreakpointLocations.some(
          selectedBreakpointLocation =>
              selectedBreakpointLocation.breakpoint.url() === breakpointLocation.breakpoint.url());
      if (matchesLocation) {
        breakpointLocation.breakpoint.setEnabled(toggleState);
      }
    });
  }

  private toggleAllBreakpoints(toggleState: boolean): void {
    for (const breakpointLocation of this.breakpointManager.allBreakpointLocations()) {
      breakpointLocation.breakpoint.setEnabled(toggleState);
    }
  }

  private removeAllBreakpoints(): void {
    for (const breakpointLocation of this.breakpointManager.allBreakpointLocations()) {
      void breakpointLocation.breakpoint.remove(false /* keepInStorage */);
    }
  }

  private removeOtherBreakpoints(selectedBreakpoints: Set<Bindings.BreakpointManager.Breakpoint>): void {
    for (const breakpointLocation of this.breakpointManager.allBreakpointLocations()) {
      if (!selectedBreakpoints.has(breakpointLocation.breakpoint)) {
        void breakpointLocation.breakpoint.remove(false /* keepInStorage */);
      }
    }
  }

  flavorChanged(_object: Object|null): void {
    this.update();
  }

  private didUpdateForTest(): void {
  }
  wasShown(): void {
    super.wasShown();
    this.registerCSSFiles([javaScriptBreakpointsSidebarPaneStyles]);
  }
}

class BreakpointItem {
  locations: BreakpointLocation[];
  text: TextUtils.Text.Text|null;
  isSelected: boolean;
  showColumn: boolean;

  constructor(
      locations: BreakpointLocation[], text: TextUtils.Text.Text|null, isSelected: boolean, showColumn: boolean) {
    this.locations = locations;
    this.text = text;
    this.isSelected = isSelected;
    this.showColumn = showColumn;
  }

  /**
   * Checks if this item has not changed compared with the other
   * Used to cache model items between re-renders
   */
  isSimilar(other: BreakpointItem): boolean|null {
    return this.locations.length === other.locations.length &&
        this.locations.every((l, idx) => l.uiLocation === other.locations[idx].uiLocation) &&
        this.locations.every((l, idx) => l.breakpoint === other.locations[idx].breakpoint) &&
        ((this.text === other.text) || (this.text && other.text && this.text.value() === other.text.value())) &&
        this.isSelected === other.isSelected && this.showColumn === other.showColumn;
  }
}

const elementToUILocationMap = new WeakMap<Element, Workspace.UISourceCode.UILocation>();

export function retrieveLocationForElement(element: Element): Workspace.UISourceCode.UILocation|undefined {
  return elementToUILocationMap.get(element);
}

const elementToBreakpointMap = new WeakMap<Element, BreakpointLocation[]>();

export interface BreakpointLocation {
  breakpoint: Bindings.BreakpointManager.Breakpoint;
  uiLocation: Workspace.UISourceCode.UILocation;
}
