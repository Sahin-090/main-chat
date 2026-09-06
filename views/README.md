# views/

This project serves its frontend as **static files** from `public/` (plain HTML/CSS/JS) and communicates with the backend purely over REST + Socket.IO — there is no server-side templating engine (no EJS/Pug/Handlebars) in the current architecture, so this folder is intentionally empty.

It's kept in the project structure in case you want to add server-rendered pages later (e.g. a marketing/landing page, password-reset email templates, or an EJS-based admin panel). To use it:

1. `npm install ejs` (or your templating engine of choice)
2. In `server.js`, add:
   ```js
   app.set('views', path.join(__dirname, 'views'));
   app.set('view engine', 'ejs');
   ```
3. Add `.ejs` files here and `res.render('filename', { data })` from any controller.
