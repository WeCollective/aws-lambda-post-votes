var AWS = require('aws-sdk');

var db = new AWS.DynamoDB.DocumentClient();

exports.handler = function(event, context, callback) {
  console.log(JSON.stringify(event, null, 2));
  event.Records.forEach(function(record) {
    console.log(record.eventID);
    console.log(record.eventName);
    console.log('DynamoDB Record: %j', record.dynamodb);

    // Check which parameter has been changed (up/down)
    var up = 0;
    var down = 0;
    if(record.dynamodb.OldImage.up < record.dynamodb.NewImage.up) {
      up = record.dynamodb.NewImage.up - record.dynamodb.OldImage.up;
    }
    if(record.dynamodb.OldImage.down < record.dynamodb.NewImage.down) {
      down = record.dynamodb.NewImage.down - record.dynamodb.OldImage.down;
    }

    if(up > 0 || down > 0) {
      // fetch the dbTable from the event ARN of the form:
      // arn:aws:dynamodb:us-east-1:111111111111:table/test/stream/2020-10-10T08:18:22.385
      // see: http://stackoverflow.com/questions/35278881/how-to-get-the-table-name-in-aws-dynamodb-trigger-function
      var dbTable = event.eventSourceARN.split(':')[5].split('/')[1];
      // update the post's individual stat on this branch
      db.update({
        TableName: dbTable,
        Key: {
          id: record.dynamodb.Keys.id,
          branchid: record.dynamodb.Keys.branchid
        },
        AttributeUpdates: {
          individual: {
            Action: 'PUT',
            Value: record.dynamodb.OldImage.individual + up - down
          }
        }
      }, function(err, data) {
        if(err) return callback(err);
        return callback(null, "message");
      });
    }

  });
  callback(null, "message");
};
