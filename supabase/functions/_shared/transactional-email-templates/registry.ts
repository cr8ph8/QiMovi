/// <reference types="npm:@types/react@18.3.1" />
import * as React from 'npm:react@18.3.1'

export interface TemplateEntry {
  component: React.ComponentType<any>
  subject: string | ((data: Record<string, any>) => string)
  to?: string
  displayName?: string
  previewData?: Record<string, any>
}

import { template as welcome } from './welcome.tsx'
import { template as submissionConfirmation } from './submission-confirmation.tsx'
import { template as contactConfirmation } from './contact-confirmation.tsx'
import { template as scoreNotification } from './score-notification.tsx'
import { template as accessRequestDecision } from './access-request-decision.tsx'
import { template as adSlotStatusChange } from './ad-slot-status-change.tsx'
import { template as founderWelcome } from './founder-welcome.tsx'
import { template as platformInvitation } from './platform-invitation.tsx'
import { template as briefCommentNotification } from './brief-comment-notification.tsx'
import { template as collaboratorInvitation } from './collaborator-invitation.tsx'

export const TEMPLATES: Record<string, TemplateEntry> = {
  'welcome': welcome,
  'submission-confirmation': submissionConfirmation,
  'contact-confirmation': contactConfirmation,
  'score-notification': scoreNotification,
  'access-request-decision': accessRequestDecision,
  'ad-slot-status-change': adSlotStatusChange,
  'founder-welcome': founderWelcome,
  'platform-invitation': platformInvitation,
  'brief-comment-notification': briefCommentNotification,
  'collaborator-invitation': collaboratorInvitation,
}

