'use client'

import {
  BookOpen,
  Folder,
  Heart,
  CalendarDays,
  Camera,
  Clock,
  CloudSun,
  Mail,
  Map,
  Music,
  Settings,
} from 'lucide-react'
import css from './icon-generator.module.css'

const neighbors = [
  { name: 'Calendar', Icon: CalendarDays },
  { name: 'Photos', Icon: Camera },
  { name: 'Weather', Icon: CloudSun },
  { name: 'Clock', Icon: Clock },
  { name: 'Mail', Icon: Mail },
  { name: 'Maps', Icon: Map },
  { name: 'Music', Icon: Music },
  { name: 'Settings', Icon: Settings },
  { name: 'Reading', Icon: BookOpen },
  { name: 'Files', Icon: Folder },
  { name: 'Health', Icon: Heart },
]

export function IconHomePreview({
  url,
  name,
  theme = 'light',
  label,
}: {
  url?: string | null
  name: string
  theme?: 'light' | 'dark'
  label: string
}) {
  return (
    <figure className={css.phoneWrap}>
      <figcaption>{label}</figcaption>
      <div className={`${css.phone} ${theme === 'dark' ? css.phoneDark : ''}`}>
        <div className={css.statusBar}>
          <span>9:41</span>
          <span className={css.island} />
          <span aria-label="Full signal and battery">▮▮▮ ▰</span>
        </div>
        <div className={css.phoneGrid}>
          {Array.from({ length: 12 }, (_, index) =>
            index === 4 ? (
              <div key="app" className={css.phoneApp}>
                {url ? (
                  <img src={url} alt={`${name} icon on home screen`} />
                ) : (
                  <div className={css.missingIcon}>?</div>
                )}
                <span>{name || 'Your app'}</span>
              </div>
            ) : (
              <div key={index} className={css.phoneApp}>
                <div className={css.neighbor}>
                  {(() => {
                    const { Icon } = neighbors[index > 4 ? index - 1 : index]
                    return (
                      <Icon size={25} strokeWidth={1.6} aria-hidden="true" />
                    )
                  })()}
                </div>
                <span>{neighbors[index > 4 ? index - 1 : index].name}</span>
              </div>
            ),
          )}
        </div>
        <div className={css.pageDots}>● ○ ○</div>
        <div className={css.dock}>
          {[Mail, Music, Camera, Settings].map((Icon, i) => (
            <div key={i}>
              <Icon size={22} strokeWidth={1.6} aria-hidden="true" />
            </div>
          ))}
        </div>
        <div className={css.homeIndicator} />
      </div>
    </figure>
  )
}
