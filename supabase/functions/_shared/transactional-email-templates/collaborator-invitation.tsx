/// <reference types="npm:@types/react@18.3.1" />
import * as React from 'npm:react@18.3.1'
import {
  Body,
  Button,
  Container,
  Head,
  Heading,
  Html,
  Link,
  Preview,
  Text,
  Hr,
} from 'npm:@react-email/components@0.0.22'
import type { TemplateEntry } from './registry.ts'

const SITE_NAME = 'Qi | Can I Screenwrite?'
const SITE_URL = 'https://caniscreenwrite.com'

interface CollaboratorInvitationProps {
  inviterName?: string
  entryTitle?: string
  role?: string
  acceptUrl?: string
}

const roleLabel = (role?: string) => {
  switch ((role || '').toLowerCase()) {
    case 'owner': return 'co-owner'
    case 'editor': return 'editor'
    case 'reviewer': return 'reviewer'
    case 'viewer': return 'viewer'
    default: return role || 'collaborator'
  }
}

const CollaboratorInvitationEmail = ({
  inviterName,
  entryTitle,
  role,
  acceptUrl,
}: CollaboratorInvitationProps) => {
  const inviter = inviterName || 'A screenwriter'
  const title = entryTitle || 'a screenplay'
  const url = acceptUrl || SITE_URL
  return (
    <Html lang="en" dir="ltr">
      <Head />
      <Preview>
        {inviter} invited you to collaborate on {title}
      </Preview>
      <Body style={main}>
        <Container style={container}>
          <Text style={brandMark}>Qi</Text>
          <Heading style={h1}>You're invited to collaborate</Heading>
          <Text style={text}>
            <strong>{inviter}</strong> invited you to collaborate on{' '}
            <strong>{title}</strong> as a <strong>{roleLabel(role)}</strong> on{' '}
            <Link href={SITE_URL} style={link}>{SITE_NAME}</Link>.
          </Text>
          <Text style={text}>
            Accept the invitation to join the brain dump thread, review the
            screenplay, and contribute alongside the writer.
          </Text>
          <Button style={button} href={url}>
            Accept Invitation
          </Button>
          <Text style={subtle}>
            This link expires in 14 days. If the button doesn't work, paste this
            URL into your browser:
            <br />
            <Link href={url} style={link}>{url}</Link>
          </Text>
          <Hr style={hr} />
          <Text style={footer}>
            If you weren't expecting this invitation, you can safely ignore this
            email — no account will be changed.
          </Text>
        </Container>
      </Body>
    </Html>
  )
}

export const template = {
  component: CollaboratorInvitationEmail,
  subject: (data: Record<string, any>) =>
    `${data?.inviterName || 'A screenwriter'} invited you to collaborate on ${data?.entryTitle || 'a screenplay'}`,
  displayName: 'Collaborator invitation',
  previewData: {
    inviterName: 'Ava Chen',
    entryTitle: 'Neon Cathedral',
    role: 'reviewer',
    acceptUrl: 'https://caniscreenwrite.com/collab/accept?token=preview',
  },
} satisfies TemplateEntry

const main = { backgroundColor: '#ffffff', fontFamily: "'Georgia', 'Times New Roman', serif" }
const container = { padding: '40px 25px', maxWidth: '560px', margin: '0 auto' }
const brandMark = { fontSize: '28px', fontWeight: 'bold' as const, color: '#c5952a', margin: '0 0 24px', fontFamily: "'Georgia', serif" }
const h1 = { fontSize: '24px', fontWeight: 'bold' as const, color: '#1a1a1a', margin: '0 0 20px', fontFamily: "'Georgia', serif" }
const text = { fontSize: '15px', color: '#55575d', lineHeight: '1.6', margin: '0 0 16px' }
const subtle = { fontSize: '12px', color: '#888888', lineHeight: '1.5', margin: '20px 0 0' }
const link = { color: '#c5952a', textDecoration: 'underline' }
const hr = { borderColor: '#e5e5e5', margin: '24px 0' }
const button = {
  backgroundColor: '#c5952a',
  color: '#0a0c10',
  fontSize: '14px',
  borderRadius: '8px',
  padding: '12px 24px',
  textDecoration: 'none',
  fontWeight: 'bold' as const,
  fontFamily: "'Georgia', serif",
}
const footer = { fontSize: '12px', color: '#999999', margin: '30px 0 0', lineHeight: '1.5' }
