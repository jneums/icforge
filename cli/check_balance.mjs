import Conf from 'conf';
const c = new Conf({projectName:'icforge'});
const token = c.get('token');
const r = await fetch('https://icforge-backend.onrender.com/api/v1/cycles/balance', {
  headers: {'Authorization': 'Bearer ' + token}
});
console.log(r.status, await r.text());
