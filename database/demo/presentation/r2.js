// usage: node r2.js upload <dir> <uploads.tsv>   |   node r2.js delete <user-uuid>...
const fs = require('fs');
const { S3Client, PutObjectCommand, ListObjectsV2Command, DeleteObjectsCommand } = require('module').createRequire('/app/package.json')('@aws-sdk/client-s3');
const e = process.env;
const s3 = new S3Client({ region: 'auto', endpoint: `https://${e.CLOUDFLARE_R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: { accessKeyId: e.CLOUDFLARE_R2_ACCESS_KEY_ID, secretAccessKey: e.CLOUDFLARE_R2_SECRET_ACCESS_KEY } });
const Bucket = e.CLOUDFLARE_R2_BUCKET_NAME;
(async () => {
  const [cmd, ...args] = process.argv.slice(2);
  if (cmd === 'upload') {
    const rows = fs.readFileSync(args[1], 'utf8').trim().split('\n').map((l) => l.split('\t'));
    for (const [file, Key] of rows) {
      await s3.send(new PutObjectCommand({ Bucket, Key, Body: fs.readFileSync(`${args[0]}/${file}`), ContentType: 'image/jpeg' }));
    }
    console.log(`uploaded ${rows.length}`);
  } else if (cmd === 'delete') {
    let n = 0;
    for (const id of args) {
      const list = await s3.send(new ListObjectsV2Command({ Bucket, Prefix: `uploads/${id}/` }));
      const objs = (list.Contents || []).map((o) => ({ Key: o.Key }));
      if (objs.length) await s3.send(new DeleteObjectsCommand({ Bucket, Delete: { Objects: objs } }));
      n += objs.length;
    }
    console.log(`deleted ${n}`);
  }
})().catch((err) => { console.error(err.message); process.exit(1); });
