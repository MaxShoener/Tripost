// server.js
const express = require('express');
const got = require('got');
const cheerio = require('cheerio');
const bodyParser = require('body-parser');
const { URL } = require('url');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());
app.use(express.static('public')); // serve frontend

// Proxy endpoint
app.get('/proxy', async (req, res) => {
  const target = req.query.u;
  if (!target) return res.status(400).send('Missing target URL');

  try {
    const response = await got(target, { responseType: 'buffer' });
    const contentType = response.headers['content-type'] || 'text/html';

    // Only rewrite HTML
    if (contentType.includes('text/html')) {
      let html = response.body.toString('utf8');
      const $ = cheerio.load(html);

      // Rewrite links, forms, images etc to pass through proxy
      $('[href],[src],[action]').each((i, el) => {
        const attr = el.attribs.href ? 'href' : el.attribs.src ? 'src' : 'action';
        if (!el.attribs[attr]) return;
        if (el.attribs[attr].startsWith('http')) {
          el.attribs[attr] = '/proxy?u=' + encodeURIComponent(el.attribs[attr]);
        }
      });

      res.setHeader('content-type', 'text/html');
      return res.send($.html());
    }

    // Non-HTML: send raw
    res.setHeader('content-type', contentType);
    return res.send(response.body);
  } catch (err) {
    return res.status(500).send('Error fetching target URL: ' + err.message);
  }
});

app.listen(PORT, () => console.log(`Server running on port ${PORT}`));