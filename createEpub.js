const fs = require("fs")
const path = require("path")
const moment = require("moment")
const nodepub = require('nodepub');
const request = require("request")

 async function createEpub(id) {
  let data = JSON.parse(fs.readFileSync(path.resolve(__dirname, `./book/${id}.json`)))
  let image = []
  let downLoadList = []
  await downLoadData(data.cover_url, data.data.metaData.recVoteTargetWorksId)
  data.data.posts[0].contents.forEach(async (item, index) => {
    if(item.type === "illus"){
      downLoadList.push(downLoadData(item.data.size.orig.src, `${data.data.metaData.recVoteTargetWorksId}_${index}`))
      image.push(`./cover/${data.data.metaData.recVoteTargetWorksId}_${index}.png`)
      item.data.size.orig.src = `../images/${data.data.metaData.recVoteTargetWorksId}_${index}.png`
    }
  })
  await Promise.all(downLoadList)
  let metadata = createMeta(data, image)
  console.log(metadata)
  let fn = makeContentsPage(data.title)
  let epub = nodepub.document(metadata, fn);
  let title = ""
  let content = ""
  epub.addCSS(`a { color: #000; font-size: 14px; } p { text-indent: 2rem; } p+p { text-indent: 0.75em; }`);
  data.data.posts[0].contents.forEach((item, index) => {
    let text = item.data?.text
    if(item.data && item.data.text){
      if(typeof item.data.text === "string") {
        text = item.data.text
      }else{
        text = item.data.text.map(item => item.content).join(" ")
      }
    }
    if(index === 0){
      title = text
    }
    if(item.type !== "pagebreak"){
      if(item.type === "illus"){
        content += `<p><img style="width: ${item.data.size.orig.width}px;height: ${item.data.size.orig.height}px;" src="${item.data.size.orig.src}" /></p>`
      } else if(item.type === "headline" && content){
        epub.addSection(title.replace(/\'/g,'’'), `<h2 style="text-align: center;">${title}</h2>${content}`, false, false);
        title = text
        content = "";
      }else if(item.type !== "headline"){
        content += `<p style="${parseStyle(item.data.format)}">${(text||'').replace(/"/g,'&quot;').replace(/</g,'&lt;').replace(/>/g,'&gt;')}</p>`
      }
    }
  })
  await epub.writeEPUB("./epub", data.title);
}

function parseStyle(format) {
  if(!format) return
  let style = ""
  if(format.p_indent){
    style += "text-indent: 2rem;"
  }
  if(format.p_center){
    style += "text-align: center;"
  }
  if(format.p_quote){
    style += "font-size: 14px;font-family: '宋体', 'arkitalic','Georgia Italic','Georgia-Italic','Georgia','Local Kaiti',STKaiti,'AR PL UKai','AR PL KaitiM GB',KaiTi,KaiTi_GB2312,'TW-Kai',cursive;"
  }
  if(format.p_align){
    style += `text-align: ${format.p_align};`
  }
  if(format.p_bold){
    style += `font-family: bold;`
  }
  if(format.t_indent){
    
  }
  return style
}

function makeContentsPage(title) {
  return (links) => {
    var contents = `<h1 style="text-align: center;">${title}</h1><ul>`;
    links.forEach((link) => {
      if (link.itemType !== "contents") {
        contents += "<li><a href='" + link.link + "'>" + link.title + "</a></li><br />";
      }
    });
    return contents + "</ul>";
  };
}

function downLoadData(url, name) {
  return new Promise(async resolve => {
    try{
     request({
        url
      },() => {
        resolve()
      }).pipe(fs.createWriteStream(`./cover/${name.replace(/ /g,'')}.png`))
    }catch(e){
      console.log(e)
      resolve()
    }
  });
}

function createMeta(data, image) {
  return  {
    id: data.data.metaData.recVoteTargetWorksId,
    cover: `./cover/${data.data.metaData.recVoteTargetWorksId}.png`,
    title: data.title.replace(/\'/g,'’'),
    series: '',
    sequence: "",
    author: data.data.metaData.author,
    fileAs: 'Me',
    genre: 'Non-Fiction',
    tags: data.data.metaData.categories.map(i => i.name).join(","),
    copyright: 'copyright',
    publisher: 'My Fake Publisher',
    published: moment(data.purchase_time*1000).format("YYYY-MM-DD"),
    language: data.lang,
    description: data.data.abstract,
    showContents: true,
    contents: 'Table of Contents',
    source: 'http://www.kcartlidge.com',
    images: image
  };
}


module.exports = {
  createEpub
}