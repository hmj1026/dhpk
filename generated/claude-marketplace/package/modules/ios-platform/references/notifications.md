# UserNotifications — medication reminders

## Interruption level: Time Sensitive (not Critical)

```swift
let content = UNMutableNotificationContent()
content.title = "用藥提醒"
content.interruptionLevel = .timeSensitive      // breaks through Focus when allowed
```

- **Time Sensitive** is the correct level for medication reminders — it can
  break through Focus/Do-Not-Disturb when the user grants the Time Sensitive
  entitlement, without the heavy approval Critical Alerts need.
- **Critical Alert** requires a special Apple entitlement and is for life-safety
  alarms; do **not** use it for general medication reminders (App Review will
  reject the unjustified use).
- Do not put PHI / drug names users wouldn't want on a lock screen into the
  notification body beyond what's necessary; respect the user's content
  preference.

## The 64-pending limit + rollover

iOS keeps at most **64 pending notification requests** per app. A medication
schedule can generate far more than 64 future doses, so:

- Schedule only a **rolling window** (e.g. the next N days that fit under 64),
  not the entire future.
- **Re-schedule on app launch / foreground** and after any schedule change to
  refill the window ("rollover scheduling").
- Use `UNCalendarNotificationTrigger` with `repeats: true` for simple fixed daily
  times to economize slots; use discrete dated triggers for irregular schedules.
- Track which doses are scheduled vs pending so confirmations (taken/skipped)
  reconcile correctly.

## Do not depend on BackgroundTasks to fire reminders

- A force-quit app will **not** be woken by `BGTaskScheduler`. Notifications
  themselves still fire (they're scheduled with the system), but any *logic* you
  hoped to run in the background to schedule them won't run reliably.
- Therefore the rollover refill happens on launch/foreground, not via a
  background task you assume will run.

## Actions & categories

- Register `UNNotificationCategory` with actions (Taken / Snooze / Skip) so the
  user can respond from the notification; handle them in the delegate and write a
  dose record.
- Snooze re-schedules a near-future request (counts against the 64 limit).

## Authorization

- Request `.alert`, `.sound`, `.badge`, and `.timeSensitive` options; handle the
  denied state (degrade to in-app reminders, prompt to enable in Settings).
