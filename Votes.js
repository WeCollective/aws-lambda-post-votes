var AWS = require('aws-sdk');

var db = new AWS.DynamoDB.DocumentClient();

exports.handler = function(event, context, callback) {
  console.log(JSON.stringify(event, null, 2));
  event.Records.forEach(function(record) {
    console.log('DynamoDB Record: %j', record.dynamodb);

    // Check which parameter has been changed (up/down)
    var up = 0;
    var down = 0;
    if(Number(record.dynamodb.OldImage.up.N) < Number(record.dynamodb.NewImage.up.N)) {
      up = Number(record.dynamodb.NewImage.up.N) - Number(record.dynamodb.OldImage.up.N);
    }
    if(Number(record.dynamodb.OldImage.down.N) < Number(record.dynamodb.NewImage.down.N)) {
      down = Number(record.dynamodb.NewImage.down.N) - Number(record.dynamodb.OldImage.down.N);
    }

    console.log("VOTES: " + up + ", " + down);

    if(up > 0 || down > 0) {
      // fetch the dbTable from the event ARN of the form:
      // arn:aws:dynamodb:us-east-1:111111111111:table/test/stream/2020-10-10T08:18:22.385
      // see: http://stackoverflow.com/questions/35278881/how-to-get-the-table-name-in-aws-dynamodb-trigger-function
      var dbTable = record.eventSourceARN.split(':')[5].split('/')[1];
      console.log("TABLE NAME: " + dbTable);
      // update the post's individual stat on this branch
      db.update({
        TableName: dbTable,
        Key: {
          id: record.dynamodb.Keys.id.S,
          branchid: record.dynamodb.Keys.branchid.S
        },
        AttributeUpdates: {
          individual: {
            Action: 'PUT',
            Value: Number(record.dynamodb.OldImage.individual.N) + up - down
          }
        }
      }, function(err, data) {
        if(err) {
          console.log(err);
          return callback(err);
        }
        console.log("SUCCESS: %j", data);
        return callback(null, "message");
      });
    }

  });
  callback(null, "message");
};
