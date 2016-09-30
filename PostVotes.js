var AWS = require('aws-sdk');

var db = new AWS.DynamoDB.DocumentClient();

exports.handler = function(event, context, callback) {
  console.log(JSON.stringify(event, null, 2));
  var promises = [];  // db operations wrapped in promises and pushed to this array
  event.Records.forEach(function(record) {
    if(record.eventName !== 'MODIFY') { return; }

    console.log('DynamoDB Record: %j', record.dynamodb);

    // fetch the dbTable from the event ARN of the form:
    // arn:aws:dynamodb:us-east-1:111111111111:table/test/stream/2020-10-10T08:18:22.385
    // see: http://stackoverflow.com/questions/35278881/how-to-get-the-table-name-in-aws-dynamodb-trigger-function
    var dbTable = record.eventSourceARN.split(':')[5].split('/')[1];

    // Update individual stat if an up/down vote has been cast
    if(record.dynamodb.OldImage.up && record.dynamodb.NewImage.up &&
       record.dynamodb.OldImage.down && record.dynamodb.NewImage.down) {
      console.log("UP AND DOWN EXIST");
      if(record.dynamodb.OldImage.up.N != record.dynamodb.NewImage.up.N ||
         record.dynamodb.OldImage.down.N != record.dynamodb.NewImage.down.N) {
        // update the post's individual stat on this branch
        promises.push(new Promise(function(resolve, reject) {
          // first ensure post still exists
          db.get({
            TableName : dbTable,
            Key: {
              id: record.dynamodb.Keys.id.S,
              branchid: record.dynamodb.Keys.branchid.S
            }
          }, function(err, data) {
            if(err) {
              console.error("Error fetching item:", err);
              return reject(err);
            }
            if(!data || !data.Item) {
              console.error("Item no longer exists: %j", {
                id: record.dynamodb.Keys.id.S,
                branchid: record.dynamodb.Keys.branchid.S
              });
              return resolve();
            }
            // item exists, perform the update
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
                console.log("Error updating item", err);
                return reject(err);
              }
              resolve();
            });
          });
        }));
      }
    }

    // Update local stats if the individual stat has been updated
    if(record.dynamodb.OldImage.individual && record.dynamodb.NewImage.individual) {
      console.log("INDIVIDUAL EXISTS");
      if(record.dynamodb.OldImage.individual.N != record.dynamodb.NewImage.individual.N) {
        var inc = Number(record.dynamodb.NewImage.individual.N) - Number(record.dynamodb.OldImage.individual.N);
        var tagTable = 'Tags';
        if(dbTable.indexOf('dev') > -1) {
          tagTable = 'dev' + tagTable;
        }
        promises.push(new Promise(function(resolve, reject) {
          // get the tags of this branch, which indicate all the branches above it in the tree
          db.query({
            TableName: tagTable,
            KeyConditionExpression: "branchid = :id",
            ExpressionAttributeValues: {
              ":id": record.dynamodb.Keys.branchid.S
            }
          }, function(err, data) {
            if(err) return reject(err);
            if(!data || !data.Items) {
              return reject('Error fetching branch tags');
            }

            // update the post's local stat on each tagged branch
            var updates = []; // wrap each update in promise and push to this array
            data.Items.forEach(function(item) {
              updates.push(new Promise(function(resolve, reject) {
                // ensure item exists first by performing a fetch
                db.get({
                  TableName : dbTable,
                  Key: {
                    id: record.dynamodb.Keys.id.S,
                    branchid: item.tag
                  }
                }, function(err, data) {
                  if(err) {
                    console.error("Error fetching item:", err);
                    return reject(err);
                  }
                  if(!data || !data.Item) {
                    console.error("Item no longer exists: %j", {
                      id: record.dynamodb.Keys.id.S,
                      branchid: item.tag
                    });
                    return resolve();
                  }
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
                      console.error("Error updating item: ", err);
                      return reject(err);
                    }
                    resolve();
                  });
                });
              }));
            });
            // resolve all tagged branch updates before resolving promise for this branch
            Promise.all(updates).then(resolve, reject);
          });
        }));
      }
    }

    // if local stat is updated on the root branch...
    if(record.dynamodb.OldImage.local && record.dynamodb.NewImage.local) {
      console.log("LOCAL EXISTS");
      if(record.dynamodb.OldImage.local.N != record.dynamodb.NewImage.local.N &&
         record.dynamodb.Keys.branchid.S === 'root') {

        // update the post's global stat on all branches:
        // first fetch post on all branches
        promises.push(new Promise(function(resolve, reject) {
          db.query({
            TableName: dbTable,
            KeyConditionExpression: "id = :id",
            ExpressionAttributeValues: {
              ":id": record.dynamodb.Keys.id.S
            }
          }, function(err, data) {
            if(err) return reject(err);
            if(!data || !data.Items) {
              return reject();
            }

            // set the post global stat on all post items to the local stat on the root branch
            var updates = [];
            data.Items.forEach(function(item) {
              updates.push(new Promise(function(resolve, reject) {
                // ensure item exists first by performing a fetch
                db.get({
                  TableName : dbTable,
                  Key: {
                    id: item.id,
                    branchid: item.branchid
                  }
                }, function(err, data) {
                  if(err) {
                    console.error("Error fetching item:", err);
                    return reject(err);
                  }
                  if(!data || !data.Item) {
                    console.error("Item no longer exists: %j", {
                      id: item.id,
                      branchid: item.branchid
                    });
                    return resolve();
                  }
                  // update the item
                  db.update({
                    TableName: dbTable,
                    Key: {
                      id: item.id,
                      branchid: item.branchid
                    },
                    AttributeUpdates: {
                      global: {
                        Action: 'PUT',
                        Value: Number(record.dynamodb.NewImage.local.N)
                      }
                    }
                  }, function(err, data) {
                    if(err) {
                      console.error("Error updating item: ", err);
                      return reject(err);
                    }
                    resolve();
                  });
                });
              }));
            });
            // resolve all branch updates before resolving promise
            Promise.all(updates).then(resolve, reject);
          });
        }));
      }
    }
  });

  // resolve all updates
  Promise.all(promises).then(function() {
    callback(null, "Successfully updated stats!");
  }, function(err) {
    console.log("Error updating stats: %j", err);
    callback("Error!");
  });
};
