// Copyright 2021 The Chromium Authors. All rights reserved.
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

import * as i18n from '../../core/i18n/i18n.js';
import type * as SDK from '../../core/sdk/sdk.js';
import * as Protocol from '../../generated/protocol.js';

import {Issue, IssueCategory, IssueKind} from './Issue.js';

import {
  resolveLazyDescription,
  type LazyMarkdownIssueDescription,
  type MarkdownIssueDescription,
} from './MarkdownIssueDescription.js';

const UIStrings = {
  /**
   *@description Title for cross-origin portal post message error
   */
  crossOriginPortalPostMessage: 'Portals - Same-origin communication channels',
};
const str_ = i18n.i18n.registerUIStrings('models/issues_manager/GenericIssue.ts', UIStrings);
const i18nLazyString = i18n.i18n.getLazilyComputedLocalizedString.bind(undefined, str_);

export class GenericIssue extends Issue {
  #issueDetails: Protocol.Audits.GenericIssueDetails;

  constructor(
      issueDetails: Protocol.Audits.GenericIssueDetails, issuesModel: SDK.IssuesModel.IssuesModel,
      issueId?: Protocol.Audits.IssueId) {
    const issueCode = [
      Protocol.Audits.InspectorIssueCode.GenericIssue,
      issueDetails.errorType,
    ].join('::');
    super(issueCode, issuesModel, issueId);
    this.#issueDetails = issueDetails;
  }

  getCategory(): IssueCategory {
    return IssueCategory.Generic;
  }

  primaryKey(): string {
    return `${this.code()}-(${this.#issueDetails.frameId})`;
  }

  getDescription(): MarkdownIssueDescription|null {
    const description = issueDescriptions.get(this.#issueDetails.errorType);
    if (!description) {
      return null;
    }
    return resolveLazyDescription(description);
  }

  details(): Protocol.Audits.GenericIssueDetails {
    return this.#issueDetails;
  }

  getKind(): IssueKind {
    return IssueKind.Improvement;
  }

  static fromInspectorIssue(issuesModel: SDK.IssuesModel.IssuesModel, inspectorIssue: Protocol.Audits.InspectorIssue):
      GenericIssue[] {
    const genericDetails = inspectorIssue.details.genericIssueDetails;
    if (!genericDetails) {
      console.warn('Generic issue without details received.');
      return [];
    }
    return [new GenericIssue(genericDetails, issuesModel, inspectorIssue.issueId)];
  }
}

export const genericCrossOriginPortalPostMessageError = {
  file: 'genericCrossOriginPortalPostMessageError.md',
  links: [{
    link: 'https://github.com/WICG/portals#same-origin-communication-channels',
    linkTitle: i18nLazyString(UIStrings.crossOriginPortalPostMessage),
  }],
};

export const genericFormLabelForNameError = {
  file: 'genericFormLabelForNameError.md',
  links: [{
    link: 'https://html.spec.whatwg.org/multipage/forms.html#attr-label-for',
    // Since the link points to a page with the same title, the 'HTML Standard'
    // string doesn't need to be translated.
    linkTitle: i18n.i18n.lockedLazyString('HTML Standard'),
  }],
};

const issueDescriptions: Map<Protocol.Audits.GenericIssueErrorType, LazyMarkdownIssueDescription> = new Map([
  [Protocol.Audits.GenericIssueErrorType.CrossOriginPortalPostMessageError, genericCrossOriginPortalPostMessageError],
  [Protocol.Audits.GenericIssueErrorType.FormLabelForNameError, genericFormLabelForNameError],
]);
