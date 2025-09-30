// server.js
const express = require('express');
const got = require('got');
const cheerio = require('cheerio');
const rateLimit = require('express-rate-limit');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// Rate limiting
app.use(rateLimit({
  windowMs: 60*1000, // 1 min
  max: 60,
  message: 'Too many requests. Wait a minute.'
}));

// Serve frontend
app.use(express.static(path.join(__dirname, 'public')));

// Proxy endpoint
app.get('/proxy', async (req,res)=>{
  const target = req.query.u;
  if(!target) return res.status(400).send('Missing URL');

  try {
    const response = await got(target, { responseType:'buffer', followRedirect:true, timeout:15000 });
    const contentType = response.headers['content-type'] || 'text/html';

    if(contentType.includes('text/html')){
      const html = response.body.toString('utf8');
      const $ = cheerio.load(html);

      // Rewrite links, forms, images to pass through proxy
      $('[href],[src],[action]').each((i,el)=>{
        const attr = el.attribs.href?'href':el.attribs.src?'src':'action';
        if(!el.attribs[attr]) return;
        if(el.attribs[attr].startsWith('http')){
          el.attribs[attr] = '/proxy?u=' + encodeURIComponent(el.attribs[attr]);
        }
      });

      res.setHeader('content-type','text/html');
      return res.send($.html());
    }

    // Non-HTML content (images, css, js)
    res.setHeader('content-type', contentType);
    return res.send(response.body);

  } catch(err){
    res.status(500).send(`<h2>Error loading page</h2><p>${err.message}</p>`);
  }
});

app.listen(PORT,()=>console.log(`Cloaker running on port ${PORT}`));