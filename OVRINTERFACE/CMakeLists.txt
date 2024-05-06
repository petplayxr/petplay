#region init

cmake_minimum_required(VERSION 3.5)
message("${CMAKE_CURRENT_SOURCE_DIR}")

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_SIZEOF_VOID_P 8)

#region BUILD MAIN PROGRAM

project(petplay)
add_executable(petplay Main.cpp 
overlay.cpp 
overlay.h
)

#region link overlay crap
target_include_directories(petplay PRIVATE ${CMAKE_CURRENT_SOURCE_DIR})
target_link_libraries(petplay Ws2_32)

#region LINK OPENVR LMAO

set( OpenVR_INCLUDE_DIR ${CMAKE_SOURCE_DIR}/../openvr/headers )
set( OpenVR_LIB_DIR ${CMAKE_SOURCE_DIR}/../openvr/lib/win64 )
set( OpenVR_BIN_DIR ${CMAKE_SOURCE_DIR}/../openvr/bin/win64 )

find_library(OPENVR_LIBRARIES
  NAMES
    openvr_api
  PATHS
    ${CMAKE_CURRENT_SOURCE_DIR}/../openvr/bin
    ${CMAKE_CURRENT_SOURCE_DIR}/../openvr/lib
  PATH_SUFFIXES
    osx32
    linux64
    win64
  NO_DEFAULT_PATH
  NO_CMAKE_FIND_ROOT_PATH
)
set(OPENVR_INCLUDE_DIR ${CMAKE_CURRENT_SOURCE_DIR}/../openvr/headers)
target_include_directories( petplay PRIVATE ${OpenVR_INCLUDE_DIR} )

# configure_file( ${OpenVR_BIN_DIR}/openvr_api.dll ${CMAKE_CURRENT_BINARY_DIR}/openvr_api.dll COPYONLY )
message ( "in" ${OpenVR_BIN_DIR}/openvr_api.dll )
message ( "out" ${CMAKE_CURRENT_BINARY_DIR}/$<CONFIG>/openvr_api.dll )
add_custom_command(TARGET petplay POST_BUILD
                   COMMAND "${CMAKE_COMMAND}" -E copy_if_different "${OpenVR_BIN_DIR}/openvr_api.dll" "${CMAKE_CURRENT_BINARY_DIR}/$<CONFIG>/"
)

target_link_libraries(petplay ${OPENVR_LIBRARIES})


#region BUILD vrmanager
# add_library(vrmanager ${CMAKE_CURRENT_SOURCE_DIR}/../aardvark/vrmanager.cpp)
# target_include_directories( vrmanager PRIVATE ${CMAKE_CURRENT_SOURCE_DIR}/aardvark/thirdparty/glm)
# target_include_directories( vrmanager PRIVATE ${CMAKE_CURRENT_SOURCE_DIR}/aardvark/thirdparty/openvr/headers)
# target_include_directories( vrmanager PRIVATE ${CMAKE_CURRENT_SOURCE_DIR}/aardvark/thirdparty)
# target_include_directories( vrmanager PRIVATE ${CMAKE_CURRENT_SOURCE_DIR}/aardvark)


# target_link_libraries(vrmanager ${CMAKE_CURRENT_SOURCE_DIR}/aardvark/thirdparty/openvr/lib/win64/openvr_api.lib)

#region BUILD aardvarkrender WIP

# find_package(Vulkan)

# add_library(avrender 
#     ${CMAKE_CURRENT_SOURCE_DIR}/aardvark/aardvark_renderer.cpp
#     ${CMAKE_CURRENT_SOURCE_DIR}/aardvark/aardvark_renderer.h
#     ${CMAKE_CURRENT_SOURCE_DIR}/aardvark/vrmanager.cpp
#     ${CMAKE_CURRENT_SOURCE_DIR}/aardvark/vrmanager.h

# )
# target_include_directories( avrender PRIVATE ${CMAKE_CURRENT_SOURCE_DIR}/aardvark/thirdparty/vulkan)
# target_include_directories( avrender PRIVATE ${CMAKE_CURRENT_SOURCE_DIR}/aardvark/thirdparty/tinygltf)
# target_include_directories( avrender PRIVATE ${CMAKE_CURRENT_SOURCE_DIR}/aardvark/thirdparty/glm)
# target_include_directories( avrender PRIVATE ${CMAKE_CURRENT_SOURCE_DIR}/aardvark/thirdparty/gli)
# target_include_directories( avrender PRIVATE ${CMAKE_CURRENT_SOURCE_DIR}/aardvark/thirdparty/openvr/headers)
# target_include_directories( avrender PRIVATE ${CMAKE_CURRENT_SOURCE_DIR}/aardvark/thirdparty)
# target_include_directories( avrender PRIVATE ${CMAKE_CURRENT_SOURCE_DIR}/aardvark/thirdparty/aardvark)
# target_include_directories( avrender PRIVATE ${CMAKE_CURRENT_SOURCE_DIR}/aardvark/)
# target_include_directories( avrender PRIVATE ${CMAKE_CURRENT_SOURCE_DIR}/aardvark//gltfpbr_base)

# target_link_libraries( avrender ${Vulkan_LIBRARY} ${WINLIBS})
# target_link_libraries( avrender ${CMAKE_CURRENT_SOURCE_DIR}/aardvark/thirdparty/aardvark)
# target_link_libraries( avrender ${CMAKE_CURRENT_SOURCE_DIR}/aardvark/tools)



# target_link_libraries(avrender ${CMAKE_CURRENT_SOURCE_DIR}/aardvark/thirdparty/openvr/lib/win64/openvr_api.lib)