bot.command('line', async (ctx) => {
  if (!isReady) return ctx.reply('❌ No host attached');
  
  const args = ctx.message.text.split(' ').slice(1);
  if (args.length < 4) return ctx.reply('Usage: /line 100 100 400 400 #ff0000 5');
  
  const [x1, y1, x2, y2, color = '#000', width = 2] = args;
  
  try {
    // Draw
    await page.evaluate((a) => {
      window.parasite.drawLine(+a.x1, +a.y1, +a.x2, +a.y2, a.color, +a.width);
    }, {x1, y1, x2, y2, color, width});
    
    console.log(`Drew line: ${x1},${y1} to ${x2},${y2}`);
    
    // Screenshot
    const canvas = await page.$('.main-canvas');
    if (!canvas) {
      return ctx.reply('❌ Canvas not found!');
    }
    
    const png = await canvas.screenshot();
    console.log('Screenshot taken');
    
    const jpg = await sharp(png).jpeg({ quality: 85 }).toBuffer();
    await ctx.replyWithPhoto({ source: jpg });
    console.log('Image sent');
    
  } catch (e) {
    console.error('Error:', e.message);
    ctx.reply('❌ Error: ' + e.message);
  }
});
