import {
  BarChart3,
  Code2,
  Crown,
  FileText,
  Microscope,
  Palette,
  Server,
  ShieldCheck,
  Smartphone,
  TestTube2,
  Wrench,
  type LucideIcon,
} from 'lucide-react'

export const TEAM_ICONS: Record<string, LucideIcon> = {
  leadership: Crown,
  analysis: Microscope,
  design: Palette,
  frontend: Code2,
  backend: Server,
  mobile: Smartphone,
  platform: Wrench,
  qa: TestTube2,
  security: ShieldCheck,
  review: Code2,
  release: FileText,
  data: BarChart3,
}

// The delivery pipeline every task goes through; `gate` marks a human approval step
export const PIPELINE = [
  { label: 'Входящие', team: null, gate: false },
  { label: 'PM: истории и критерии', team: 'leadership', gate: false },
  { label: 'Аналитика: спецификация', team: 'analysis', gate: false },
  { label: 'Архитектор: решение', team: 'leadership', gate: false },
  { label: 'Одобрение плана', team: null, gate: true },
  { label: 'Дизайн', team: 'design', gate: false },
  { label: 'Разработка: фронт, бэк, мобайл, платформа', team: 'frontend', gate: false },
  { label: 'Code Review', team: 'review', gate: false },
  { label: 'QA по тест-плану', team: 'qa', gate: false },
  { label: 'Безопасность', team: 'security', gate: false },
  { label: 'Релиз: PR и changelog', team: 'release', gate: false },
  { label: 'Одобрение релиза', team: null, gate: true },
  { label: 'Готово', team: null, gate: false },
] as const
