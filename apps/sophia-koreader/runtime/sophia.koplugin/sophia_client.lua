-- SPDX-License-Identifier: AGPL-3.0-or-later

local JSON = require("json")
local http = require("socket.http")
local https = require("ssl.https")
local socket = require("socket")
local socketutil = require("socketutil")

local Client = {}

local function headers(token, accept)
    local value = {
        ["Accept"] = accept,
        ["User-Agent"] = socketutil.USER_AGENT .. " Sophia/0.1",
    }
    if token and token ~= "" then
        value["Authorization"] = "Bearer " .. token
    end
    return value
end

local function transportFor(url)
    if url:match("^https://") then return https end
    if url:match("^http://") then return http end
    return nil
end

local function request(request_table, block_timeout, total_timeout)
    local transport = transportFor(request_table.url)
    if not transport then return false, "URL must use http:// or https://" end

    socketutil:set_timeout(block_timeout, total_timeout)
    local invoked, first, second, third, fourth = pcall(transport.request, request_table)
    socketutil:reset_timeout()
    if not invoked then return false, first end

    local code, response_headers, status = socket.skip(1, first, second, third, fourth)
    if response_headers == nil then
        return false, status or code or "network error"
    end
    if type(code) ~= "number" or code < 200 or code >= 300 then
        return false, status or ("HTTP " .. tostring(code)), code
    end
    return true, response_headers, code
end

function Client.fetchJSON(url, token)
    local chunks = {}
    local ok, err, code = request({
        url = url,
        method = "GET",
        headers = headers(token, "application/json"),
        sink = socketutil.table_sink(chunks),
    }, socketutil.LARGE_BLOCK_TIMEOUT, socketutil.LARGE_TOTAL_TIMEOUT)
    if not ok then return false, err, code end
    local body = table.concat(chunks)
    local decoded, value = pcall(JSON.decode, body)
    if not decoded or type(value) ~= "table" then
        return false, "manifest is not valid JSON"
    end
    return true, value
end

function Client.download(url, token, destination, accept)
    local temporary = destination .. ".part"
    local file, open_err = io.open(temporary, "wb")
    if not file then return false, open_err end
    local sink, sink_err = socketutil.file_sink(file)
    if not sink then
        pcall(function() file:close() end)
        return false, sink_err
    end
    local ok, err, code = request({
        url = url,
        method = "GET",
        headers = headers(token, accept or "application/octet-stream"),
        sink = sink,
    }, socketutil.FILE_BLOCK_TIMEOUT, socketutil.FILE_TOTAL_TIMEOUT)
    pcall(function() file:close() end)
    if not ok then
        os.remove(temporary)
        return false, err, code
    end
    local renamed, rename_err = os.rename(temporary, destination)
    if not renamed then
        os.remove(temporary)
        return false, rename_err
    end
    return true
end

function Client.resolve(manifest_url, relative_path)
    if type(relative_path) ~= "string" then return nil end
    if relative_path:match("^https?://") then return relative_path end
    if relative_path:sub(1, 1) == "/" then
        local origin = manifest_url:match("^(https?://[^/]+)")
        return origin and (origin .. relative_path) or nil
    end
    local base = manifest_url:match("^(.*[/])[^/]*$")
    return base and (base .. relative_path) or nil
end

return Client

