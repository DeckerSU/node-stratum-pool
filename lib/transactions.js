var bitcoin = require('bitgo-utxo-lib');
var util = require('./util.js');

// public members
var txHash;

exports.txHash = function(){
  return txHash;
};

function scriptCompile(addrHash){
    script = bitcoin.script.compile(
        [
            bitcoin.opcodes.OP_DUP,
            bitcoin.opcodes.OP_HASH160,
            addrHash,
            bitcoin.opcodes.OP_EQUALVERIFY,
            bitcoin.opcodes.OP_CHECKSIG
        ]);
    return script;
}

function scriptFoundersCompile(address){
    script = bitcoin.script.compile(
        [
            bitcoin.opcodes.OP_HASH160,
            address,
            bitcoin.opcodes.OP_EQUAL
        ]);
    return script;
}


exports.createGeneration = function(blockHeight, blockReward, feeReward, recipients, poolAddress, payFoundersReward, percentFoundersReward, maxFoundersRewardBlockHeight, foundersRewardAddressChangeInterval, vFoundersRewardAddress, percentTreasuryReward, treasuryRewardStartBlockHeight, treasuryRewardAddressChangeInterval, vTreasuryRewardAddress, daemonCoinbase = false){

    if (daemonCoinbase) {
        var tx = new bitcoin.Transaction.fromHex(daemonCoinbase, bitcoin.networks.zcash);
        txHex = tx.toHex();
        txHash = tx.getHash().toString('hex');
        return txHex;
    }

    var poolAddrHash = bitcoin.address.fromBase58Check(poolAddress).hash;
    
    var tx = new bitcoin.Transaction(bitcoin.networks.zcash);
    
    tx.version = 4;
    tx.overwintered = 1;
    tx.versionGroupId = 0x892f2085;

    // other way to create coinbase is using TransactionBuilder as it implemented here https://github.com/webworker01/node-stratum-pool/pull/2/files#diff-f93a07160f04dcdcbc518aa0f4eab9fdR51 ,
    // but this way needs to modify transaction_builder.js in bitgo-utxo-lib to avoid `coinbase inputs not supported` error. example of this 
    // modification is available here https://raw.githubusercontent.com/miketout/bitgo-utxo-lib/master/src/transaction_builder.js .
    
    /*
    var tx = new bitcoin.TransactionBuilder(bitcoin.networks.zcash);
    tx.setVersion(bitcoin.Transaction.ZCASH_SAPLING_VERSION);
    tx.setVersionGroupId(0x892f2085);
    */  
    
    // input for coinbase tx
    if (blockHeight.toString(16).length % 2 === 0) {
        var blockHeightSerial = blockHeight.toString(16);
    } else {
        var blockHeightSerial = '0' + blockHeight.toString(16);
    }
    var height = Math.ceil((blockHeight << 1).toString(2).length / 8);
    var lengthDiff = blockHeightSerial.length/2 - height;
    for (var i = 0; i < lengthDiff; i++) {
        blockHeightSerial = blockHeightSerial + '00';
    } 
    length = '0' + height;
    var serializedBlockHeight = new Buffer.concat([
        new Buffer(length, 'hex'),
        util.reverseBuffer(new Buffer(blockHeightSerial, 'hex')),
        new Buffer('00', 'hex') // OP_0
    ]);

    tx.addInput(new Buffer('0000000000000000000000000000000000000000000000000000000000000000', 'hex'),
        4294967295,
        4294967295,
        new Buffer.concat([serializedBlockHeight,
            Buffer('5a2d4e4f4d50212068747470733a2f2f6769746875622e636f6d2f4465636b657253552f7a2d6e6f6d70', 'hex')]) //Z-NOMP! https://github.com/DeckerSU/z-nomp
    );
    
    // calculate total fees
    var feePercent = 0;
    for (var i = 0; i < recipients.length; i++) {
        feePercent = feePercent + recipients[i].percent;
    }

    // txs with founders reward
    if (payFoundersReward === true && (maxFoundersRewardBlockHeight >= blockHeight || treasuryRewardStartBlockHeight)) {

        // founders or treasury reward?
        if (treasuryRewardStartBlockHeight && blockHeight >= treasuryRewardStartBlockHeight) {

            // treasury reward
            var index = parseInt(Math.floor(((blockHeight - treasuryRewardStartBlockHeight) / treasuryRewardAddressChangeInterval) % vTreasuryRewardAddress.length));
            var foundersAddrHash = bitcoin.address.fromBase58Check(vTreasuryRewardAddress[index]).hash;

            //console.log("treasuryIndex: "+index);
            //console.log("treasuryAddr:  "+vTreasuryRewardAddress[index]);

            // pool t-addr
            tx.addOutput(
                scriptCompile(poolAddrHash),
                Math.round(blockReward * (1 - (percentTreasuryReward + feePercent) / 100)) + feeReward
            );
            // treasury t-addr
            tx.addOutput(
                scriptFoundersCompile(foundersAddrHash),
                Math.round(blockReward * (percentTreasuryReward / 100))
            );
            
        } else {

            // founders reward
            var index = parseInt(Math.floor(blockHeight / foundersRewardAddressChangeInterval));
            var foundersAddrHash = bitcoin.address.fromBase58Check(vFoundersRewardAddress[index]).hash;

            //console.log("foundersIndex: "+index);
            //console.log("foundersAddr:  "+vFoundersRewardAddress[index]);

            // pool t-addr
            tx.addOutput(
                scriptCompile(poolAddrHash),
                Math.round(blockReward * (1 - (percentFoundersReward + feePercent) / 100)) + feeReward
            );
            // founders t-addr
            tx.addOutput(
                scriptFoundersCompile(foundersAddrHash),
                Math.round(blockReward * (percentFoundersReward / 100))
            );
        }
    }
    // no founders rewards :)
    else
    {
        // pool t-addr
        tx.addOutput(
            scriptCompile(poolAddrHash),
            Math.round(blockReward * (1 - (feePercent / 100))) + feeReward
        ); 
    }

    // pool fee recipients t-addr
    for (var i = 0; i < recipients.length; i++) {
       tx.addOutput(
           scriptCompile(bitcoin.address.fromBase58Check(recipients[i].address).hash),
           Math.round(blockReward * (recipients[i].percent / 100))
       );
    }

    /* tx = tx.build(); // for using with TransactionBuilder only */
    txHex = tx.toHex();
    
    // assign
    txHash = tx.getHash().toString('hex');

    /*
    console.log('txHex: ' + txHex.toString('hex'));
    console.log('txHash: ' + txHash);
    */

    return txHex;
};

module.exports.getFees = function(feeArray){
    var fee = Number();
    feeArray.forEach(function(value) {
        fee = fee + Number(value.fee);
    });
    return fee;
};
