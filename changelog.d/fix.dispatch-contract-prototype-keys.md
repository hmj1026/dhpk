scope: cli-dispatch
note: 修正 dispatch-contract 的 translateLegacyRequest 對 constructor、toString、hasOwnProperty、__proto__ 等原型鏈鍵名未拋出 unknown legacy role 的問題，改用自有屬性查找 (#1397).
