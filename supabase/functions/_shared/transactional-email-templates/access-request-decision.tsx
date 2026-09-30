import * as React from 'npm:react@18.3.1'
import {
  Body, Container, Head, Heading, Html, Preview, Text, Button, Hr,
} from 'npm:@react-email/components@0.0.22'
import type { TemplateEntry } from './registry.ts'

const SITE_NAME = "Qi | Can I Screenwrite?"

interface AccessRequestDecisionProps {
  displayName?: string
  tier?: string
  decision?: 'approved' | 'denied'
}

const AccessRequestDecisionEmail = ({ displayName, tier, decision }: AccessRequestDecisionProps) => {
  const isApproved = decision === 'approved'
  return (
    <Html lang="en" dir="ltr">
      <Head />
      <Preview>
        {isApproved
          ? `Your access request for ${tier || 'the platform'} has been approved`
          : 'Update on your access request'}
      </Preview>
      <Body style={main}>
        <Container style={container}>
          <Heading style={h1}>
            {displayName ? `Hi ${displayName},` : 'Hello,'}
          </Heading>

          {isApproved ? (
            <>
              <Text style={statusBadgeApproved}>✅ Approved</Text>
              <Text style={text}>
                Great news — your request for <strong>{tier || 'access'}</strong> has been approved.
                You now have full access to the features included in this tier.
              </Text>
              <Hr style={hr} />
              <Button style={button} href="https://caniscreenwrite.com/auth">
                Sign In Now
              </Button>
            </>
          ) : (
            <>
              <Text style={statusBadgeDenied}>❌ Not Approved</Text>
              <Text style={text}>
                Unfortunately, your request for <strong>{tier || 'access'}</strong> was not approved at this time.
                You're welcome to re-apply in the future or reach out if you have questions.
              </Text>
            </>
          )}

          <Text style={footer}>
            Best regards,<br />The {SITE_NAME} Team
          </Text>
        </Container>
      </Body>
    </Html>
  )
}

export const template = {
  component: AccessRequestDecisionEmail,
  subject: (data: Record<string, any>) =>
    data.decision === 'approved'
      ? 'Your access request has been approved'
      : 'Update on your access request',
  displayName: 'Access request decision',
  previewData: { displayName: 'Alex', tier: 'Extended', decision: 'approved' },
} satisfies TemplateEntry

const main = { backgroundColor: '#ffffff', fontFamily: "'Georgia', 'Times New Roman', serif" }
const container = { padding: '40px 25px', maxWidth: '560px', margin: '0 auto' }
const h1 = { fontSize: '24px', fontWeight: 'bold' as const, color: '#1a1a1a', margin: '0 0 20px', fontFamily: "'Georgia', serif" }
const text = { fontSize: '15px', color: '#55575d', lineHeight: '1.6', margin: '0 0 16px' }
const statusBadgeApproved = { fontSize: '14px', color: '#16a34a', fontWeight: 'bold' as const, margin: '0 0 16px', padding: '6px 12px', backgroundColor: '#f0fdf4', borderRadius: '6px', display: 'inline-block' as const }
const statusBadgeDenied = { fontSize: '14px', color: '#dc2626', fontWeight: 'bold' as const, margin: '0 0 16px', padding: '6px 12px', backgroundColor: '#fef2f2', borderRadius: '6px', display: 'inline-block' as const }
const hr = { borderColor: '#e5e5e5', margin: '24px 0' }
const button = {
  backgroundColor: '#c5952a',
  color: '#0a0c10',
  padding: '12px 24px',
  borderRadius: '8px',
  fontWeight: 'bold' as const,
  fontSize: '14px',
  textDecoration: 'none',
  display: 'inline-block' as const,
  fontFamily: "'Georgia', serif",
}
const footer = { fontSize: '12px', color: '#999999', margin: '30px 0 0', lineHeight: '1.5' }
