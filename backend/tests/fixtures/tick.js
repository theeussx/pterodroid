let n = 0;
setInterval(() => {
  n += 1;
  console.log(`tick ${n} @ ${Date.now()}`);
}, 500);
console.log('tick-service started, pid', process.pid);
