var AWS = require('aws-sdk');

var db = new AWS.DynamoDB.DocumentClient();

exports.handler = function(event, context, callback) {
  console.log(JSON.stringify(event, null, 2));
  event.Records.forEach(function(record) {
    console.log('DynamoDB Record: %j', record.dynamodb);

    // Update stats if a vote has been cast
    if(record.dynamodb.OldImage.up.N != record.dynamodb.NewImage.up.N ||
       record.dynamodb.OldImage.down.N != record.dynamodb.NewImage.down.N) {
      // fetch the dbTable from the event ARN of the form:
      // arn:aws:dynamodb:us-east-1:111111111111:table/test/stream/2020-10-10T08:18:22.385
      // see: http://stackoverflow.com/questions/35278881/how-to-get-the-table-name-in-aws-dynamodb-trigger-function
      var dbTable = record.eventSourceARN.split(':')[5].split('/')[1];

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
            Value: Number(record.dynamodb.NewImage.up.N) - Number(record.dynamodb.NewImage.down.N)
          }
        }
      }, function(err, data) {
        if(err) {
          console.log(err);
          return callback(err);
        }
        console.log("SUCCESS");
      });
    }
  });
  callback(null, "Successfully updated stats!");
};
