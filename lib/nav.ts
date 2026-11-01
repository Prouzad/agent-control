import {
  Activity,
  BarChart3,
  Bot,
  FolderTree,
  GraduationCap,
  KanbanSquare,
  LayoutDashboard,
  ListTree,
  type LucideIcon,
  Settings,
  Users,
  Wallet,
  Workflow,
} from 'lucide-react'

export type NavItem = { href: string; label: string; icon: LucideIcon; hint: string }

export const NAV_ITEMS: NavItem[] = [
  { href: '/', label: 'Обзор', icon: LayoutDashboard, hint: 'Сводка и экипаж' },
  { href: '/live', label: 'Live', icon: Activity, hint: 'Что агенты делают сейчас' },
  { href: '/tasks', label: 'Задачи', icon: KanbanSquare, hint: 'Канбан и запуск агентов' },
  { href: '/pipelines', label: 'Конвейеры', icon: Workflow, hint: 'Этапы с гейтами' },
  { href: '/lessons', label: 'Уроки', icon: GraduationCap, hint: 'Правила из прошлых ошибок' },
  { href: '/agents', label: 'Агенты', icon: Bot, hint: 'Роли и их роботы' },
  { href: '/teams', label: 'Команды', icon: Users, hint: 'Оргструктура' },
  { href: '/sessions', label: 'Сессии', icon: ListTree, hint: 'История Claude Code' },
  { href: '/analytics', label: 'Аналитика', icon: BarChart3, hint: 'Токены и стоимость' },
  { href: '/projects', label: 'Проекты', icon: FolderTree, hint: 'Дерево проектов' },
  { href: '/accounts', label: 'Аккаунты', icon: Wallet, hint: 'Подписки и ключи' },
  { href: '/settings', label: 'Настройки', icon: Settings, hint: 'Хуки и лимиты' },
]
