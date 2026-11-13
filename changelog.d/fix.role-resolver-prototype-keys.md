scope: cli-dispatch
note: 修正 cli-role-resolver 對 constructor、toString、hasOwnProperty、__proto__ 等原型鏈鍵名拋出 TypeError 的問題，改為回傳 BLOCKED 的 unknown role (#1364).
