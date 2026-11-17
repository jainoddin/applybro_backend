# New-tab portal sign-in

Connect account opens /portal-connect?portal=LINKEDIN (or NAUKRI) on the same frontend origin. This is an authenticated remote view of the existing server browser, not a direct linkedin.com tab on the user's device.

The user clicks the browser image and types into the selected remote field using the secure text input. Click, allowed keys, scrolling and text entry are explicit user actions. The backend does not answer or bypass CAPTCHA. Inputs are masked in screenshots. Frame versions prevent acting on an older image. Only the authenticated owner and current viewer attempt may control the browser; controls expire after five minutes.

A connection is announced only after the relay observes signed-in state and saves the encrypted session. The viewer then notifies its opener and closes. The opener checks the backend independently before displaying Connected. Tokens/passwords are not passed in URLs or postMessage. User-entered command text is not logged or persisted and is cleared after sending.

Closing an unfinished viewer uses the existing pending-session cleanup; verified sessions remain saved. An upstream access denial, login failure, screenshot failure or server restart can still prevent completion. This feature does not guarantee 24/7 hosting or automatic job submission.

Validation: backend build, frontend production build, owner/lease/frame/secret tests and a real Chromium synthetic login flow. These tests do not prove a real LinkedIn or Naukri sign-in.
