# YouTrack2GitLab
Import YouTrack issues into GitLab.

## Install

```
npm install -g youtrack2gitlab
```

## Usage

```
yt2gl -i <input> -u <users> -g <gitlaburl> -p <project> -t <token>
```

## Options

```
-i, --input
 CSV file exported from YouTrack (Example: issues.csv)

-u, --users
 User mapping file (Example: users.json)

-g, --gitlaburl
 GitLab URL hostname (Example: gitlab.example.com)

-p, --project
 GitLab project name including namespace (Example: mycorp/myproj)

-t, --token
 An admin user's private token (Example: a2r33oczFyQzq53t23Vj)
```

## User Mapping File
In order to correctly map users you should create a JSON file with the following format and specify it with the **-u** switch:

```
[
  {
    "yt_username": "USER'S USERNAME IN YOUTRACK",
    "yt_name": "USER'S NAME IN YOUTRACK",
    "gl_username": "USER'S USERNAME IN GITLAB",
    "gl_private_token": "USER'S PRIVATE TOKEN IN GITLAB"
  },
  …
]
```

## Notes
- Make sure the input CSV file only includes issues for the project you want to import.
- Make sure that all users have write access to the specified repository or some issues will fail to import. A safer approach is to set repository's **Visibility Level** to **Public** and revert it when the import process is complete.
- In version 6.4.3, GitLab API does not support setting creation date of issues. So all imported issues will have a creation time of now.
- In version 6.4.3, GitLab API fails to import issues with very long titles.
- In version 6.4.3, GitLab does not allow issues to be deleted. So be careful when importing issues into an active project.
- Milestones are not currently supported.

## Version History
+ **1.0**
	+ Initial release

## Author
**Soheil Rashidi**

+ http://soheilrashidi.com
+ http://twitter.com/soheilpro
+ http://github.com/soheilpro

## Copyright and License
Copyright 2014 Soheil Rashidi

Licensed under the The MIT License (the "License");
you may not use this work except in compliance with the License.
You may obtain a copy of the License in the LICENSE file, or at:

http://www.opensource.org/licenses/mit-license.php

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License.
