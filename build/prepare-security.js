'use strict';
exports.default=async()=>{const prepare=require.resolve('../tools/prepare-security');delete require.cache[prepare];require(prepare);};
