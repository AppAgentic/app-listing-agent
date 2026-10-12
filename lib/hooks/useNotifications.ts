'use client'

import { useState, useEffect, useCallback } from 'react'

export type NotificationPermission = 'default' | 'granted' | 'denied'

export interface UseNotificationsReturn {
  permission: NotificationPermission
  isSupported: boolean
  requestPermission: () => Promise<boolean>
  sendNotification: (title: string, options?: NotificationOptions) => void
}

export function useNotifications(): UseNotificationsReturn {
  const [permission, setPermission] = useState<NotificationPermission>('default')
  const [isSupported, setIsSupported] = useState(false)

  useEffect(() => {
    // Check if notifications are supported
    if (typeof window !== 'undefined' && 'Notification' in window) {
      setIsSupported(true)
      setPermission(Notification.permission as NotificationPermission)
    }
  }, [])

  const requestPermission = useCallback(async (): Promise<boolean> => {
    if (!isSupported) return false

    try {
      const result = await Notification.requestPermission()
      setPermission(result as NotificationPermission)
      return result === 'granted'
    } catch (error) {
      console.error('Error requesting notification permission:', error)
      return false
    }
  }, [isSupported])

  const sendNotification = useCallback(
    (title: string, options?: NotificationOptions) => {
      if (!isSupported || permission !== 'granted') {
        console.log('Notifications not available or not permitted')
        return
      }

      try {
        const notification = new Notification(title, {
          icon: '/icon-192.png',
          badge: '/icon-192.png',
          ...options,
        })

        // Auto-close after 5 seconds
        setTimeout(() => notification.close(), 5000)

        // Focus window when clicked
        notification.onclick = () => {
          window.focus()
          notification.close()
        }
      } catch (error) {
        console.error('Error sending notification:', error)
      }
    },
    [isSupported, permission]
  )

  return {
    permission,
    isSupported,
    requestPermission,
    sendNotification,
  }
}
