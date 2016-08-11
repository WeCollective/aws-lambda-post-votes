var AWS = require('aws-sdk');

var db = new AWS.DynamoDB.DocumentClient();

exports.handler = function(event, context, callback) {
  console.log(JSON.stringify(event, null, 2));
  event.Records.forEach(function(record) {
    console.log('DynamoDB Record: %j', record.dynamodb);

    // fetch the dbTable from the event ARN of the form:
    // arn:aws:dynamodb:us-east-1:111111111111:table/test/stream/2020-10-10T08:18:22.385
    // see: http://stackoverflow.com/questions/35278881/how-to-get-the-table-name-in-aws-dynamodb-trigger-function
    var dbTable = record.eventSourceARN.split(':')[5].split('/')[1];

    // Update individual stat if an up/down vote has been cast
    if(record.dynamodb.OldImage.up.N != record.dynamodb.NewImage.up.N ||
       record.dynamodb.OldImage.down.N != record.dynamodb.NewImage.down.N) {
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
          return callback(err); // TODO: should we error out?
        }
        console.log("SUCCESS INDIVIDUAL");
      });
    }

    // Update local stats if the individual stat has been updated
    if(record.dynamodb.OldImage.individual.N != record.dynamodb.NewImage.individual.N) {
      var inc = Number(record.dynamodb.NewImage.individual.N) - Number(record.dynamodb.OldImage.individual.N);
      console.log("INCREMENTING: " + inc);
      // get the tags of this branch, which indicate all the branches above it in the tree
      db.query({
        TableName: dbTable,
        KeyConditionExpression: "branchid = :id",
        ExpressionAttributeValues: {
          ":id": record.dynamodb.Keys.branchid.S
        }
      }, function(err, data) {
        if(err) return callback(err);
        if(!data || !data.Items) {
          return callback('Error fetching branch tags');
        }

        console.log("UPDATING %j", data.Items);
        // update the post's local stat on each tagged branch
        data.Items.forEach(function(item) {
          db.update({
            TableName: dbTable,
            Key: {
              id: record.dynamodb.Keys.id.S,
              branchid: item.tag
            },
            AttributeUpdates: {
              local: {
                Action: 'ADD',
                Value: inc
              }
            }
          }, function(err, data) {
            if(err) {
              console.log("ERROR LOCAL %j", err);
              return callback(err); // TODO: should we error out?
            }
            console.log("SUCCESS LOCAL");
          });
        });
      });
    }
  });
  callback(null, "Successfully updated stats!");
};
