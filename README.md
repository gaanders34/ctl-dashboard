# CTL Daily Production Report Dashboard

Dashboard for the **Cut-to-Length (CTL)** daily production report — matches the format of the director’s daily email (½ line & Redbud, 1st/2nd/3rd shifts, coils, downtime, manpower, hours scheduled).

## What it shows

- **Summary**: Total coils, ½ line total, Redbud total, total downtime, man-hours scheduled
- **Per line** (½ line, Redbud):
  - **1st, 2nd & 3rd shift**: coils, downtime (duration + reason), crew size, 12-hour shift
  - Optional **notes** (e.g. “Lost our main operator”)
  - **Line total** coils
- **Charts**: Coils by line & shift; downtime by line (minutes)

## Branding

Place the Willbanks Metals logo as **`assets/willbanks-logo.png`** (it appears in the header on all tabs). Use a transparent or white-background PNG for best results in both light and dark themes.

## Quick start

Open `index.html` in a browser, or run a local server (see **Local network** below). Use the **Dark** / **Light** button in the header to switch color scheme; the choice is saved for the next visit.

### Simple HTTP server (dev / small team)

From a terminal in the project folder:

```bash
cd C:\Users\george.anderson\Projects\ctl-dashboard
```

**Option A — Python (port 8080):**
```bash
python -m http.server 8080
```

**Option B — Node (port 3000):**
```bash
npx serve -l 3000
```

Then open **http://localhost:8080** (or **http://localhost:3000**). Others on the same network use **http://&lt;this-PC-IP&gt;:8080** (find IP with `ipconfig`). Or double‑click **`start-server.bat`** to do the same without typing commands.

## Local network (access from 2 or more computers)

To use the dashboard on **this PC and another computer on the same Wi‑Fi/LAN**:

1. **On the PC that has the app folder**  
   Double‑click **`start-server.bat`** (or run it from a terminal in this folder).  
   The window will show:
   - **This computer:** open **http://localhost:8080** (or **:3000** if using Node).
   - **Other computers:** a URL like **http://192.168.1.100:8080** — the batch file tries to show this PC’s IP so you can copy it.

2. **On the second computer (same network)**  
   Open a browser and go to the URL shown for “other computers” (e.g. **http://192.168.1.100:8080**).  
   If the batch didn’t show an IP, on the **first** PC run `ipconfig` and use its **IPv4 Address** with the same port (8080 or 3000).

3. **If the other computer can’t connect**  
   - When Windows asks, choose **Allow** for Python or Node on **Private** networks.  
   - Or: Windows Security → Firewall → Allow an app → find Python or Node.js → enable **Private**.

The server listens on all network interfaces (not only localhost), so both PCs can use the app at the same time. Data (schedule, open status, etc.) is stored in each browser’s **localStorage**, so it’s per device; the server only serves the files.

## Updating with the daily email

Edit **`data.js`** and update the `CTL_REPORT` object to match that day’s email.

1. Set **`reportDate`** to the report date (YYYY-MM-DD).
2. For each **line** (`½ line`, Redbud):
   - **shifts**: one object per shift (1st, 2nd, 3rd) with:
     - `coils` — number of coils
     - `downtime` — array of `{ durationText: "1 ½ hours", durationMinutes: 90, reason: "..." }`
       - Use `durationMinutes` for charts (e.g. 1½ hr = 90, 25 min = 25).
     - `crew` — number of people
     - `shiftHours` — 12
     - `notes` — optional (e.g. "Lost our main operator")
   - **lineTotal** — total coils for that line
3. Set **grandTotal** to total coils (e.g. 41).

Example from your email:

- ½ line 1st: 12 coils, 1½ hr down (Peeler table leaking oil; West cone not spinning), 6-man, 12 hr → `durationMinutes: 90`
- Redbud 1st: 13 coils, 25 min QC + 1 hr table full, 5-man, 12 hr
- Redbud 2nd: 8 coils, no downtime, note “Lost our main operator”, 6-man, 12 hr

## Files

| File        | Purpose                                  |
|------------|------------------------------------------|
| `index.html` | Report layout and summary/lines/charts  |
| `styles.css` | Styling                                 |
| `data.js`    | Report data — **edit this for each day** |
| `app.js`     | Renders report and draws charts         |

## Optional next steps

- **Date picker**: Add a control to switch between multiple saved reports (e.g. by date).
- **Import from email**: Paste email text into a textarea and parse it into `CTL_REPORT` (e.g. with simple rules or a small parser).
- **History**: Store past reports (e.g. in `localStorage` or an API) and show trends over time.
