'use strict'
var Pool = require('pg').Pool
const lib = require('response-helper-functions')

var config = {
  host: process.env.PG_HOST,
  user: process.env.PG_USER,
  password: process.env.PG_PASSWORD,
  database: process.env.PG_DATABASE
}

var COMPONENT_NAME = process.env.COMPONENT_NAME
var COMPONENT_RESOURCE_TABLE = process.env.COMPONENT_RESOURCE_TABLE || COMPONENT_NAME.replace(/-/g, '_')

var pool = new Pool(config)

function createResourceThen(res, id, resource, callback) {
  var query = `INSERT INTO ${COMPONENT_RESOURCE_TABLE} (id, etag, data) values('${id}', '${lib.uuid4()}', '${JSON.stringify(resource)}') RETURNING etag`
  pool.query(query, function (err, pgResult) {
    if (err)
      lib.internalError(res, err)
    else {
      if (pgResult.rowCount === 0) 
        lib.duplicate(res, `resource with id ${id} already exists`)
      else {
        var row = pgResult.rows[0];
        callback(row.etag)
      }
    }
  })
}

function withResourceDo(res, id, callback) {
  pool.query(`SELECT etag, data FROM ${COMPONENT_RESOURCE_TABLE} WHERE id = $1`, [id], function (err, pg_res) {
    if (err) 
      lib.internalError(res, err)
    else
      if (pg_res.rowCount === 0)
        rLib.notFound(res, `resource with id ${id} does not exist`)
      else {
        var row = pg_res.rows[0]
        callback(row.data, row.etag)
      }
  })
}

function deleteResourceThen(res, id, callback) {
  var query = `DELETE FROM ${COMPONENT_RESOURCE_TABLE} WHERE id = '${id}' RETURNING *`
  pool.query(query, function (err, pgResult) {
    if (err)
      lib.internalError(res, err)
    else {
      if (pgResult.rowCount === 0) 
        lib.notFound(res, `resource with id ${id} does not exist`)
      else {
        var row = pgResult.rows[0];
        callback(pgResult.rows[0].data, pgResult.rows[0].etag)
      }
    }
  })
}

function updateResourceThen(res, id, resource, etag, callback) {
  var query
  if (etag)
     query = `UPDATE ${COMPONENT_RESOURCE_TABLE} SET (etag, data) = ('${lib.uuid4()}', '${JSON.stringify(resource)}') WHERE id = '${id}' AND etag = '${etag}' RETURNING etag`
  else
     query = `UPDATE ${COMPONENT_RESOURCE_TABLE} SET (data) = ('${JSON.stringify(resource)}') WHERE id = '${id}' RETURNING etag`  
  pool.query(query, function (err, pgResult) {
    if (err) {
      console.log(query)
      console.log(err)
      lib.internalError(res, err)
    } else {
      if (pgResult.rowCount === 0) 
        lib.notFound(res, `resource with id ${id} does not exist`)
      else {
        var row = pgResult.rows[0];
        callback(row.etag)
      }
    }
  })
}

function init(callback) {
  var query = `CREATE TABLE IF NOT EXISTS ${COMPONENT_RESOURCE_TABLE} (id text primary key, etag text, data jsonb)`
  pool.connect(function(err, client, release) {
    if(err)
      console.error(`error creating ${COMPONENT_RESOURCE_TABLE} table`, err)
    else
      client.query(query, function(err, pgResult) {
        if(err) {
          release()
          console.error(`error creating ${COMPONENT_RESOURCE_TABLE} table`, err)
        } else {
          query = `CREATE INDEX IF NOT EXISTS ${COMPONENT_RESOURCE_TABLE}_data_inx ON ${COMPONENT_RESOURCE_TABLE} USING gin (data)`
          client.query(query, function(err, pgResult) {
            if(err) {
              release()
              console.error(`error creating ${COMPONENT_RESOURCE_TABLE}_data_inx index`, err)
            } else {
              release()
              console.log('permissions-maintenance-db: connected to PG, config: ', config)
              callback()
            }
          })
        }
      })
  })    

}

process.on('unhandledRejection', function(e) {
  console.log(e.message, e.stack)
})

exports.createResourceThen = createResourceThen
exports.updateResourceThen = updateResourceThen
exports.deleteResourceThen = deleteResourceThen
exports.withResourceDo = withResourceDo
exports.init = init