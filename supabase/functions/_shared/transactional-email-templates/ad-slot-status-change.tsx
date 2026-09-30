import * as React from 'npm:react@18.3.1'
import {
  Body, Container, Head, Heading, Html, Preview, Text, Hr,
} from 'npm:@react-email/components@0.0.22'
import type { TemplateEntry } from './registry.ts'

const SITE_NAME = "Cinema Aurea"

interface AdSlotStatusChangeProps {
  advertiser_name?: string
  new_status?: string
  bid_amount?: string
}

const STATUS_LABELS: Record<string, string> = {
  approved: 'Approved',
  active: 'Activated',
  expired: 'Expired',
  rejected: 'Rejected',
}

const STATUS_MESSAGES: Record<string, string> = {
  approved: 'Your ad slot bid has been approved. It will be activated shortly.',
  active: 'Your ad slot is now live and visible to audiences. It will run for 30 days.',
  expired: 'Your ad slot has expired. You can submit a new bid at any time.',
  rejected: 'Unfortunately, your ad slot bid was not accepted at this time.',
}

const AdSlotStatusChangeEmail = ({ advertiser_name, new_status, bid_amount }: AdSlotStatusChangeProps) => {
  const label = STATUS_LABELS[new_status || ''] || new_status || 'Updated'
  const message = STATUS_MESSAGES[new_status || ''] || 'Your ad slot status has been updated.'

  return (
    <Html lang="en" dir="ltr">
      <Head />
      <Preview>Ad Slot {label} — {SITE_NAME}</Preview>
      <Body style={main}>
        <Container style={container}>
          <Heading style={h1}>Ad Slot {label}</Heading>
          <Text style={text}>
            {advertiser_name ? `Hello ${advertiser_name},` : 'Hello,'}
          </Text>
          <Text style={text}>{message}</Text>
          {bid_amount && (
            <Text style={detailText}>
              <strong>Bid Amount:</strong> {bid_amount}
            </Text>
          )}
          <Hr style={hr} />
          <Text style={footer}>
            — The {SITE_NAME} Team
          </Text>
        </Container>
      </Body>
    </Html>
  )
}

export const template = {
  component: AdSlotStatusChangeEmail,
  subject: (data: Record<string, any>) =>
    `Ad Slot ${STATUS_LABELS[data?.new_status] || 'Updated'} — ${SITE_NAME}`,
  displayName: 'Ad slot status change',
  previewData: {
    advertiser_name: 'Acme Studios',
    new_status: 'approved',
    bid_amount: '$50.00',
  },
} satisfies TemplateEntry

const main = { backgroundColor: '#ffffff', fontFamily: "'Inter', Arial, sans-serif" }
const container = { padding: '32px 28px', maxWidth: '480px', margin: '0 auto' }
const h1 = { fontSize: '22px', fontWeight: '700' as const, color: '#1a1a1a', margin: '0 0 20px' }
const text = { fontSize: '14px', color: '#3a3a3a', lineHeight: '1.6', margin: '0 0 16px' }
const detailText = { fontSize: '14px', color: '#3a3a3a', lineHeight: '1.6', margin: '0 0 16px', padding: '12px 16px', backgroundColor: '#f5f0e8', borderRadius: '6px' }
const hr = { borderColor: '#e5e0d5', margin: '24px 0' }
const footer = { fontSize: '12px', color: '#999999', margin: '0' }
