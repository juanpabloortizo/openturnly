# The booking page on your own website

A business that already has a website can take bookings there, without sending customers
to another page. **Settings → Booking page → Share your page → Add to your website** writes
the code for each business, ready to copy; paste it where you want it. In WordPress it goes
in a "Custom HTML" block; in Wix, Squarespace or Shopify, in their "Embed code" element.

## In the page

```html
<div data-openturnly="your-business"></div>
<script src="https://your-openturnly-address/embed.js" async></script>
```

The booking steps appear where the `div` is, as wide as the space around them (up to
768 px). The frame grows and shrinks with each step, so there is no inner scrollbar, and
each new step scrolls back to its top. The business's logo, cover and description are left
out: the website around it already shows who the business is.

## A floating button

```html
<div data-openturnly="your-business" data-mode="button" data-label="Book now" data-color="#0f766e"></div>
<script src="https://your-openturnly-address/embed.js" async></script>
```

A button in the bottom-right corner that opens the booking page on top of the website; on a
phone it takes the whole screen. `data-label` and `data-color` (a `#rrggbb` colour) are
optional. Escape, the × or a click outside close it.

Several `data-openturnly` elements, of several businesses, can share one `embed.js`. Sites
that add content after loading (single-page apps) can call `window.OpenTurnly.mount()` once
the element is on the page.

## Without scripts

Some site builders only take an iframe:

```html
<iframe src="https://your-openturnly-address/your-business?embed=1" title="Book an appointment"
  style="width:100%;height:760px;border:0" loading="lazy"></iframe>
```

Its height is fixed: raise it if a scrollbar shows.

## Good to know

- OpenTurnly must be served over HTTPS when the website is: browsers block an `http://`
  page inside an `https://` one.
- Only booking pages opened with `?embed` can be shown inside other websites. The admin and
  the sign-in pages refuse to be framed, so nobody can trick a signed-in user into clicking
  through someone else's page.
- Bookings made there are the same as on the booking page: same rules, same protection
  against fake bookings, same workflows.
