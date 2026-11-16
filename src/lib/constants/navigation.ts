import {
  ChartColumn,
  FileText,
  Globe,
  LayoutDashboard,
  Send,
  Settings,
  Sparkles,
  Users,
  Workflow,
  type LucideIcon,
} from 'lucide-react'

export type NavItem = {
  title: string
  path: string
  icon: LucideIcon
  description: string
}

export type NavGroup = {
  label: string
  items: NavItem[]
}

export const NAV_GROUPS: NavGroup[] = [
  {
    label: 'Overview',
    items: [
      { title: 'Dashboard', path: '/', icon: LayoutDashboard, description: 'Sending totals, recent campaigns and account warnings.' },
    ],
  },
  {
    label: 'Audience',
    items: [
      { title: 'Contacts', path: '/contacts', icon: Users, description: 'Subscribers, lists, tags and CSV imports.' },
    ],
  },
  {
    label: 'Email',
    items: [
      { title: 'Campaigns', path: '/campaigns', icon: Send, description: 'One-off broadcasts: write, preview, test, schedule and send.' },
      { title: 'Sequences', path: '/sequences', icon: Workflow, description: 'Automated multi-step emails with delays between steps.' },
      { title: 'Templates', path: '/templates', icon: FileText, description: 'Reusable email layouts for launches, affiliates and follow-ups.' },
      { title: 'AI Writer', path: '/ai-writer', icon: Sparkles, description: 'Draft subject lines and email copy, then review before sending.' },
    ],
  },
  {
    label: 'Account',
    items: [
      { title: 'Sender Domains', path: '/sender-domains', icon: Globe, description: 'Verify a sending domain with DKIM, SPF and DMARC.' },
      { title: 'Reports', path: '/reports', icon: ChartColumn, description: 'Delivery, bounces, complaints, opens and clicks.' },
      { title: 'Settings', path: '/settings', icon: Settings, description: 'Workspace, timezone, sender defaults and usage.' },
    ],
  },
]

export const NAV_ITEMS: NavItem[] = NAV_GROUPS.flatMap((group) => group.items)

export function findNavItem(pathname: string): NavItem | undefined {
  if (pathname === '/') return NAV_ITEMS[0]
  return NAV_ITEMS.find((item) => item.path !== '/' && pathname.startsWith(item.path))
}
